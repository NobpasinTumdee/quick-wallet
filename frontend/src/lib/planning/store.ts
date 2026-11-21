/**
 * Planning's client store: the server's snapshot plus a queue of writes.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SCREEN SHOWS
 * ---------------------------------------------------------------------------
 * Always `server snapshot` with every pending write replayed on top of it.
 * Nothing optimistic is ever written into the snapshot itself, so:
 *   - a background refresh replaces the snapshot and the pending writes are
 *     simply replayed again: a row still being saved never flips back;
 *   - a failed write rolls back by leaving the queue — there is no undo to
 *     get wrong;
 *   - a write's answer that lands while a refresh is in flight is replayed
 *     onto that refresh's result too, so an older read cannot undo it.
 *
 * ---------------------------------------------------------------------------
 * ONE WRITE AT A TIME
 * ---------------------------------------------------------------------------
 * As in the Notes editor: every write carries `baseUpdatedAt`, so two in
 * flight at once would have the second refused by the first. The queue sends
 * them in order, and each one reads its base from the snapshot at the moment
 * it is sent, after the previous answer has been applied.
 *
 * Rows made on this device start with a temporary id (`tmp-…`). Writes that
 * refer to one wait in the queue behind its create; when the create answers,
 * the temporary id maps to the real one, and later writes and the replay use
 * the real id. If the create fails, the writes that depended on it are
 * dropped with it.
 *
 * After any failure the queue fetches the whole list once and waits for it
 * before sending anything else, so the next write's base is the server's.
 * ========================================================================= */

import type { PlanItem, PlanKind, PlanMilestone, PlanningData, PlanProject, PlanStatus, PlanTable } from '../../types/planning';
import {
  EMPTY_PLANNING,
  RANK_STEP,
  TEMP_PREFIX,
  applyRenumbered,
  columnEnd,
  columnItems,
  isTempId,
  patchRow,
  removeMilestoneLocal,
  removeProjectLocal,
  removeRows,
  removeStatusLocal,
  reorderStatusesLocal,
  setStatusKindLocal,
  statusesOf,
  upsertRows,
} from './model';

/* ---- Transport (injected, so the store runs in Node tests) ---- */

export type PlanningAction =
  | 'project.save'
  | 'project.delete'
  | 'status.save'
  | 'status.reorder'
  | 'status.delete'
  | 'item.save'
  | 'item.move'
  | 'item.archive'
  | 'item.delete'
  | 'milestone.save'
  | 'milestone.delete';

export interface PlanningTransport {
  list(options?: { includeArchived?: boolean }): Promise<PlanningData>;
  call(action: PlanningAction, body: Record<string, unknown>): Promise<unknown>;
}

/** The parts of an ApiError the store reads. */
interface WireError {
  status?: number;
  code?: string;
  message?: string;
  current?: unknown;
}

export interface PlanningHooks {
  /** A write failed and was rolled back. */
  onError?: (message: string) => void;
  /** A status reorder was refused; the server's order is shown. */
  onReorderRefused?: () => void;
  now?: () => string;
}

/* ---- Queue entries ---- */

type Patch = (data: PlanningData) => PlanningData;
type Resolve = (id: string) => string;

interface SendContext {
  resolve: Resolve;
  /** The snapshot's updatedAt for a row (by resolved id). */
  base: (table: PlanTable, id: string) => string;
  force: boolean;
}

/** How a write ended, for whoever is waiting on it (the card sheet's description). */
export type WriteOutcome = 'saved' | 'failed' | 'dropped';

interface Op {
  seq: number;
  /**
   * Writes with the same key for the same row merge while the earlier one is
   * still waiting in the queue (not yet sent): the later fields replace the
   * earlier ones and only one request goes. One key per field (title,
   * description, checklist as a whole list…), so a title edit never rides
   * along with a description write or the other way round.
   */
  coalesce?: string;
  /** The fields an update sends; merged into by a coalesced write. */
  fields?: Record<string, unknown>;
  settled?: (outcome: WriteOutcome) => void;
  /** Its failure is reported by whoever is waiting on it (no generic toast). */
  silent?: boolean;
  table: PlanTable;
  /** The row this write is about (may be a temporary id). */
  rowId: string;
  /** Temporary ids this write needs to exist. */
  needs: string[];
  /** The temporary id(s) this write creates. */
  creates: string[];
  /** 'reorder': a refusal just takes the server order. 'dialog': ask the user. */
  onConflict: 'dialog' | 'reorder';
  force: boolean;
  optimistic: (data: PlanningData, resolve: Resolve) => PlanningData;
  send: (ctx: SendContext) => Promise<unknown>;
  commit: (result: unknown, ctx: SendContext) => Patch;
}

export interface PlanningConflict {
  table: PlanTable;
  rowId: string;
  /** The row as stored now (from the 409's `current`). */
  current: unknown;
}

export interface PlanningState {
  /** Snapshot + pending writes, or null before the first load. */
  data: PlanningData | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  /** Writes not yet confirmed (queued or in flight). */
  saving: number;
  /** The data includes archived cards. */
  archivedLoaded: boolean;
  conflict: PlanningConflict | null;
  loadedAt: number;
}

function stampId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${random}`;
}

function errorOf(err: unknown): WireError {
  return (err && typeof err === 'object' ? err : { message: String(err) }) as WireError;
}

/* ---- The store ---- */

export class PlanningStore {
  private server: PlanningData | null = null;
  private pending: Op[] = [];
  private ids = new Map<string, string>();
  private log: Patch[] | null = null;
  private fetching: Promise<void> | null = null;
  private running = false;
  private seq = 0;
  private listeners = new Set<() => void>();
  private snapshot: PlanningState;
  private loading = false;
  private error: string | null = null;
  private errorCode: string | null = null;
  private loadedAt = 0;
  private conflict: PlanningConflict | null = null;
  /** The write being sent right now (never merged into). */
  private inFlight: Op | null = null;
  /** Archived cards were asked for (the Archived list was opened): every later read includes them. */
  private withArchived = false;
  /** Edits still being typed (a description waiting out its debounce). */
  private drafts = new Set<string>();

  private readonly transport: PlanningTransport;
  private readonly hooks: PlanningHooks;

  constructor(transport: PlanningTransport, hooks: PlanningHooks = {}) {
    this.transport = transport;
    this.hooks = hooks;
    this.snapshot = this.build();
  }

  /* ---- Subscription ---- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlanningState => this.snapshot;

  /** A temporary id's real id, once its create has answered. */
  resolve = (id: string): string => this.ids.get(id) ?? id;

  private now(): string {
    return this.hooks.now ? this.hooks.now() : new Date().toISOString();
  }

  private build(): PlanningState {
    let data = this.server;
    if (data) {
      for (const op of this.pending) {
        try {
          data = op.optimistic(data, this.resolve);
        } catch {
          /* A replay that no longer applies shows nothing rather than break the board. */
        }
      }
    }
    return {
      data,
      loading: this.loading,
      error: this.error,
      errorCode: this.errorCode,
      saving: this.pending.length,
      archivedLoaded: this.withArchived && this.loadedAt > 0,
      conflict: this.conflict,
      loadedAt: this.loadedAt,
    };
  }

  private emit(): void {
    this.snapshot = this.build();
    this.listeners.forEach((fn) => fn());
  }

  /* ---- Reading ---- */

  /** Fetches the whole list; one request at a time. */
  load(force = false): Promise<void> {
    if (this.fetching) return this.fetching;
    if (!force && this.server && Date.now() - this.loadedAt < 2000) return Promise.resolve();
    this.loading = true;
    this.log = [];
    this.emit();
    this.fetching = this.transport
      .list(this.withArchived ? { includeArchived: true } : undefined)
      .then((fresh) => {
        let next: PlanningData = {
          projects: fresh?.projects ?? [],
          statuses: fresh?.statuses ?? [],
          milestones: fresh?.milestones ?? [],
          items: fresh?.items ?? [],
        };
        /* Answers that landed while this read was out are newer than it. */
        (this.log ?? []).forEach((patch) => {
          next = patch(next);
        });
        this.server = next;
        this.error = null;
        this.errorCode = null;
        this.loadedAt = Date.now();
      })
      .catch((err: unknown) => {
        const e = errorOf(err);
        this.error = e.message || 'Request failed';
        this.errorCode = e.code ?? 'UNKNOWN';
      })
      .finally(() => {
        this.log = null;
        this.fetching = null;
        this.loading = false;
        this.emit();
      });
    return this.fetching;
  }

  /** Archived cards: read once when first asked for, and with every read after. */
  loadArchived(): Promise<void> {
    if (this.withArchived && this.loadedAt > 0 && !this.fetching) return Promise.resolve();
    this.withArchived = true;
    if (this.fetching) return this.fetching.then(() => this.load(true));
    return this.load(true);
  }

  /** Whether any write is still queued or being sent. */
  hasUnsent(): boolean {
    return this.pending.length > 0 || this.drafts.size > 0;
  }

  /** Marks an edit that is typed but not yet handed to the queue. */
  setDraft(key: string, pending: boolean): void {
    if (pending) this.drafts.add(key);
    else this.drafts.delete(key);
  }

  /* ---- The queue ---- */

  private settle(op: Op, outcome: WriteOutcome): void {
    try {
      op.settled?.(outcome);
    } catch {
      /* A listener's problem is not the queue's. */
    }
  }

  private drop(keep: (op: Op) => boolean): void {
    const dropped = this.pending.filter((op) => !keep(op));
    this.pending = this.pending.filter(keep);
    dropped.forEach((op) => this.settle(op, 'dropped'));
  }

  private applyServer(patch: Patch): void {
    this.server = patch(this.server ?? EMPTY_PLANNING);
    this.log?.push(patch);
  }

  private context(op: Op): SendContext {
    return {
      resolve: this.resolve,
      base: (table, id) => {
        const real = this.resolve(id);
        const row = (this.server?.[table] as { id: string; updatedAt?: string }[] | undefined)?.find((r) => r.id === real);
        return row?.updatedAt ?? '';
      },
      force: op.force,
    };
  }

  /** Whether every temporary id this write needs exists or is still being created. */
  private satisfiable(needs: string[]): boolean {
    return needs.every((id) => !isTempId(id) || this.ids.has(id) || this.pending.some((op) => op.creates.includes(id)));
  }

  private enqueue(op: Omit<Op, 'seq' | 'force'>): void {
    if (!this.satisfiable(op.needs)) {
      this.settle(op as Op, 'dropped');
      return;
    }
    if (op.coalesce && op.fields) {
      const row = this.resolve(op.rowId);
      const waiting = this.pending.find(
        (other) =>
          other !== this.inFlight &&
          other.coalesce === op.coalesce &&
          other.table === op.table &&
          this.resolve(other.rowId) === row,
      );
      if (waiting && waiting.fields) {
        Object.assign(waiting.fields, op.fields);
        const before = waiting.settled;
        const after = op.settled;
        if (after) {
          waiting.settled = before
            ? (outcome) => {
                before(outcome);
                after(outcome);
              }
            : after;
        }
        this.emit();
        return;
      }
    }
    this.pending.push({ ...op, seq: (this.seq += 1), force: false });
    this.emit();
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length && !this.conflict) {
        if (this.fetching) await this.fetching;
        const op = this.pending[0];
        const ctx = this.context(op);
        let result: unknown;
        this.inFlight = op;
        try {
          result = await op.send(ctx);
        } catch (err) {
          this.inFlight = null;
          await this.failed(op, errorOf(err));
          continue;
        }
        this.inFlight = null;
        this.pending.shift();
        this.applyServer(op.commit(result, ctx));
        this.emit();
        this.settle(op, 'saved');
      }
    } finally {
      this.running = false;
    }
  }

  private async failed(op: Op, err: WireError): Promise<void> {
    if (err.status === 409 && op.onConflict === 'reorder') {
      this.pending.shift();
      const current = err.current as { statuses?: PlanStatus[] } | undefined;
      if (current?.statuses) {
        const statuses = current.statuses;
        const projectId = statuses[0]?.projectId;
        this.applyServer((data) => upsertRows(projectId ? { ...data, statuses: data.statuses.filter((s) => s.projectId !== projectId) } : data, { statuses }));
      }
      this.emit();
      this.settle(op, 'dropped');
      this.hooks.onReorderRefused?.();
      if (!current?.statuses) await this.load(true);
      return;
    }
    if (err.status === 409 && err.current !== undefined) {
      /* Paused, with the user's version still on screen, until they choose. */
      this.conflict = { table: op.table, rowId: op.rowId, current: err.current };
      this.emit();
      return;
    }
    /* Anything else: roll back (leave the queue), drop what depended on it,
       and fetch once so the next write is based on the server's rows. */
    this.pending.shift();
    if (op.creates.length) {
      this.drop((other) => !other.needs.some((id) => op.creates.includes(id)));
    }
    this.emit();
    this.settle(op, 'failed');
    if (!op.silent) this.hooks.onError?.(err.message || 'Request failed');
    await this.load(true);
  }

  /** The conflict dialog's choice. */
  resolveConflict(choice: 'latest' | 'mine'): void {
    const conflict = this.conflict;
    const op = this.pending[0];
    if (!conflict || !op) return;
    this.conflict = null;
    if (choice === 'mine') {
      op.force = true;
    } else {
      const current = conflict.current as { id?: string } | null;
      const rowId = this.resolve(conflict.rowId);
      if (current && typeof current === 'object' && current.id) {
        this.applyServer((data) => upsertRows(data, { [conflict.table]: [current] }));
      }
      /* This write and every later one for the same row were built on the
         version the user just chose to drop. */
      this.drop((other) => !(other.table === conflict.table && this.resolve(other.rowId) === rowId));
    }
    this.emit();
    void this.pump();
  }

  /* ---- Projects ---- */

  createProject(fields: Partial<PlanProject>, statusNames: string[]): string {
    const tempId = stampId();
    const statusIds = [0, 1, 2, 3].map(() => stampId());
    const kinds: PlanKind[] = ['todo', 'todo', 'doing', 'done'];
    const stamp = this.now();
    this.enqueue({
      table: 'projects',
      rowId: tempId,
      needs: [],
      creates: [tempId, ...statusIds],
      onConflict: 'dialog',
      optimistic: (data) => {
        const sortOrder = data.projects.reduce((m, p) => Math.max(m, p.sortOrder + 1), 0);
        const project: PlanProject = {
          id: tempId, name: '', description: '', color: '', icon: '', state: 'active', startDate: '', dueDate: '',
          linkedGoalId: '', sortOrder, createdAt: stamp, updatedAt: stamp, linkedGoalMissing: false, ...fields,
        };
        const statuses: PlanStatus[] = statusIds.map((id, i) => ({
          id, projectId: tempId, name: statusNames[i] ?? '', color: '', order: i, kind: kinds[i], createdAt: stamp, updatedAt: stamp,
        }));
        return upsertRows(data, { projects: [project], statuses });
      },
      send: () => this.transport.call('project.save', { ...fields, statusNames }),
      commit: (result) => {
        const { project, statuses } = result as { project: PlanProject; statuses: PlanStatus[] };
        this.ids.set(tempId, project.id);
        statuses.forEach((s, i) => statusIds[i] && this.ids.set(statusIds[i], s.id));
        return (data) => upsertRows(data, { projects: [project], statuses });
      },
    });
    return tempId;
  }

  updateProject(id: string, fields: Partial<PlanProject>): void {
    this.enqueue({
      table: 'projects',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => patchRow(data, 'projects', r(id), fields),
      send: (ctx) => this.transport.call('project.save', { ...fields, id: ctx.resolve(id), ...this.guard(ctx, 'projects', id) }),
      commit: (result) => (data) => upsertRows(data, { projects: [(result as { project: PlanProject }).project] }),
    });
  }

  deleteProject(id: string): void {
    this.enqueue({
      table: 'projects',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => removeProjectLocal(data, r(id)),
      send: (ctx) => this.transport.call('project.delete', { id: ctx.resolve(id), ...this.guard(ctx, 'projects', id) }),
      commit: (_result, ctx) => (data) => removeProjectLocal(data, ctx.resolve(id)),
    });
  }

  /* ---- Statuses ---- */

  createStatus(projectId: string, fields: Pick<PlanStatus, 'name'> & Partial<PlanStatus>): string {
    const tempId = stampId();
    const stamp = this.now();
    this.enqueue({
      table: 'statuses',
      rowId: tempId,
      needs: [projectId],
      creates: [tempId],
      onConflict: 'dialog',
      optimistic: (data, r) => {
        const order = statusesOf(data, r(projectId)).reduce((m, s) => Math.max(m, s.order + 1), 0);
        const status: PlanStatus = {
          id: tempId, projectId: r(projectId), color: '', order, kind: 'todo', createdAt: stamp, updatedAt: stamp, ...fields,
        };
        return upsertRows(data, { statuses: [status] });
      },
      send: (ctx) => this.transport.call('status.save', { ...fields, projectId: ctx.resolve(projectId) }),
      commit: (result) => {
        const { status } = result as { status: PlanStatus };
        this.ids.set(tempId, status.id);
        return (data) => upsertRows(data, { statuses: [status] });
      },
    });
    return tempId;
  }

  updateStatus(id: string, fields: Partial<Pick<PlanStatus, 'name' | 'color' | 'kind'>>): void {
    const stamp = this.now();
    this.enqueue({
      table: 'statuses',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => {
        const { kind, ...rest } = fields;
        const next = patchRow(data, 'statuses', r(id), rest);
        return kind ? setStatusKindLocal(next, r(id), kind, stamp) : next;
      },
      send: (ctx) => this.transport.call('status.save', { ...fields, id: ctx.resolve(id), ...this.guard(ctx, 'statuses', id) }),
      commit: (result) => {
        const { status, items } = result as { status: PlanStatus; items: PlanItem[] };
        return (data) => upsertRows(data, { statuses: [status], items: items ?? [] });
      },
    });
  }

  reorderStatuses(projectId: string, statusIds: string[]): void {
    this.enqueue({
      table: 'statuses',
      rowId: `order:${projectId}`,
      needs: [projectId, ...statusIds],
      creates: [],
      onConflict: 'reorder',
      optimistic: (data, r) => reorderStatusesLocal(data, r(projectId), statusIds.map(r)),
      send: (ctx) => this.transport.call('status.reorder', { projectId: ctx.resolve(projectId), statusIds: statusIds.map(ctx.resolve) }),
      commit: (result) => (data) => upsertRows(data, { statuses: (result as { statuses: PlanStatus[] }).statuses }),
    });
  }

  deleteStatus(id: string, moveToStatusId: string | null): void {
    const stamp = this.now();
    this.enqueue({
      table: 'statuses',
      rowId: id,
      needs: moveToStatusId ? [id, moveToStatusId] : [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => removeStatusLocal(data, r(id), moveToStatusId ? r(moveToStatusId) : null, stamp),
      send: (ctx) =>
        this.transport.call('status.delete', {
          id: ctx.resolve(id),
          ...this.guard(ctx, 'statuses', id),
          ...(moveToStatusId ? { moveToStatusId: ctx.resolve(moveToStatusId) } : {}),
        }),
      commit: (result, ctx) => {
        const { items } = result as { items: PlanItem[] };
        return (data) => upsertRows(removeRows(data, 'statuses', [ctx.resolve(id)]), { items: items ?? [] });
      },
    });
  }

  /* ---- Milestones ---- */

  createMilestone(projectId: string, fields: Pick<PlanMilestone, 'title'> & Partial<PlanMilestone>): string {
    const tempId = stampId();
    const stamp = this.now();
    this.enqueue({
      table: 'milestones',
      rowId: tempId,
      needs: [projectId],
      creates: [tempId],
      onConflict: 'dialog',
      optimistic: (data, r) => {
        const order = data.milestones.filter((m) => m.projectId === r(projectId)).reduce((m, x) => Math.max(m, x.order + 1), 0);
        const milestone: PlanMilestone = {
          id: tempId, projectId: r(projectId), description: '', dueDate: '', state: 'open', order, createdAt: stamp, updatedAt: stamp,
          ...fields,
        };
        return upsertRows(data, { milestones: [milestone] });
      },
      send: (ctx) => this.transport.call('milestone.save', { ...fields, projectId: ctx.resolve(projectId) }),
      commit: (result) => {
        const { milestone } = result as { milestone: PlanMilestone };
        this.ids.set(tempId, milestone.id);
        return (data) => upsertRows(data, { milestones: [milestone] });
      },
    });
    return tempId;
  }

  /**
   * Title, description, due date, state or order. A one-field edit merges into
   * a waiting edit of the same field (never into the one already sent).
   */
  updateMilestone(id: string, input: Partial<Pick<PlanMilestone, 'title' | 'description' | 'dueDate' | 'state' | 'order'>>): void {
    const fields = { ...input };
    const keys = Object.keys(fields);
    this.enqueue({
      table: 'milestones',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      coalesce: keys.length === 1 ? `field:${keys[0]}` : undefined,
      fields: fields as Record<string, unknown>,
      optimistic: (data, r) => patchRow(data, 'milestones', r(id), fields),
      send: (ctx) => this.transport.call('milestone.save', { ...fields, id: ctx.resolve(id), ...this.guard(ctx, 'milestones', id) }),
      commit: (result) => (data) => upsertRows(data, { milestones: [(result as { milestone: PlanMilestone }).milestone] }),
    });
  }

  /** Deletes a milestone; its cards stay, with no milestone. */
  deleteMilestone(id: string): void {
    const stamp = this.now();
    this.enqueue({
      table: 'milestones',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => removeMilestoneLocal(data, r(id), stamp),
      send: (ctx) => this.transport.call('milestone.delete', { id: ctx.resolve(id), ...this.guard(ctx, 'milestones', id) }),
      commit: (result, ctx) => {
        const { items } = result as { items?: PlanItem[] };
        return (data) => upsertRows(removeMilestoneLocal(data, ctx.resolve(id), stamp), { items: items ?? [] });
      },
    });
  }

  /* ---- Cards ---- */

  createItem(projectId: string, statusId: string, fields: Pick<PlanItem, 'title'> & Partial<PlanItem>): string {
    const tempId = stampId();
    const stamp = this.now();
    this.enqueue({
      table: 'items',
      rowId: tempId,
      needs: [projectId, statusId],
      creates: [tempId],
      onConflict: 'dialog',
      optimistic: (data, r) => {
        const status = data.statuses.find((s) => s.id === r(statusId));
        const item: PlanItem = {
          id: tempId, projectId: r(projectId), statusId: r(statusId), milestoneId: '', description: '',
          priority: 'none', labels: [], startDate: '', dueDate: '', completedAt: status?.kind === 'done' ? stamp : '',
          rank: columnEnd(data, r(statusId)), checklist: [], budget: null, linkedTxIds: [], linkedNoteId: '',
          archivedAt: '', createdAt: stamp, updatedAt: stamp, spent: 0, missingTxIds: [], linkedNoteMissing: false,
          ...fields,
        };
        return upsertRows(data, { items: [item] });
      },
      send: (ctx) => this.transport.call('item.save', { ...fields, projectId: ctx.resolve(projectId), statusId: ctx.resolve(statusId) }),
      commit: (result) => {
        const { item } = result as { item: PlanItem };
        this.ids.set(tempId, item.id);
        return (data) => upsertRows(data, { items: [item] });
      },
    });
    return tempId;
  }

  /**
   * Field edits. A different `statusId` puts the card at the end of that
   * column. A one-field edit merges into a waiting edit of the same field.
   */
  updateItem(
    id: string,
    input: Partial<PlanItem>,
    options: { settled?: (outcome: WriteOutcome) => void; silent?: boolean } = {},
  ): void {
    const stamp = this.now();
    const fields: Partial<PlanItem> = { ...input };
    const keys = Object.keys(fields);
    this.enqueue({
      table: 'items',
      rowId: id,
      /* A milestone made a moment ago may still have its temporary id. */
      needs: [id, ...(fields.statusId ? [fields.statusId] : []), ...(fields.milestoneId ? [fields.milestoneId] : [])],
      creates: [],
      onConflict: 'dialog',
      coalesce: keys.length === 1 && keys[0] !== 'statusId' ? `field:${keys[0]}` : undefined,
      fields: fields as Record<string, unknown>,
      settled: options.settled,
      silent: options.silent,
      optimistic: (data, r) => {
        const real = r(id);
        const item = data.items.find((i) => i.id === real);
        if (!item) return data;
        const patch: Partial<PlanItem> = { ...fields };
        if (fields.statusId && r(fields.statusId) !== item.statusId) {
          const status = data.statuses.find((s) => s.id === r(fields.statusId as string));
          patch.statusId = r(fields.statusId);
          patch.rank = columnEnd(data, patch.statusId);
          patch.completedAt = status?.kind === 'done' ? item.completedAt || stamp : '';
        } else {
          delete patch.statusId;
        }
        if (fields.milestoneId) patch.milestoneId = r(fields.milestoneId);
        return patchRow(data, 'items', real, patch);
      },
      send: (ctx) =>
        this.transport.call('item.save', {
          ...fields,
          ...(fields.statusId ? { statusId: ctx.resolve(fields.statusId) } : {}),
          ...(fields.milestoneId ? { milestoneId: ctx.resolve(fields.milestoneId) } : {}),
          id: ctx.resolve(id),
          ...this.guard(ctx, 'items', id),
        }),
      commit: (result) => (data) => upsertRows(data, { items: [(result as { item: PlanItem }).item] }),
    });
  }

  /**
   * A card dropped in `statusId` at `index` of that column (counted without
   * the card). The neighbours are taken now, from what the user sees, and
   * sent as afterId / beforeId — the server picks the rank.
   */
  moveItem(id: string, statusId: string, index: number): void {
    const view = this.snapshot.data;
    if (!view) return;
    const column = columnItems(view, statusId).filter((i) => i.id !== id);
    const at = Math.max(0, Math.min(index, column.length));
    const afterId = at > 0 ? column[at - 1].id : undefined;
    const beforeId = at < column.length ? column[at].id : undefined;
    const stamp = this.now();
    this.enqueue({
      table: 'items',
      rowId: id,
      needs: [id, statusId, ...(afterId ? [afterId] : []), ...(beforeId ? [beforeId] : [])],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => {
        const item = data.items.find((i) => i.id === r(id));
        const status = data.statuses.find((s) => s.id === r(statusId));
        if (!item || !status) return data;
        const lo = afterId ? data.items.find((i) => i.id === r(afterId))?.rank : undefined;
        const hi = beforeId ? data.items.find((i) => i.id === r(beforeId))?.rank : undefined;
        const rank =
          lo !== undefined && hi !== undefined
            ? (lo + hi) / 2
            : lo !== undefined
              ? lo + RANK_STEP
              : hi !== undefined
                ? hi - RANK_STEP
                : columnEnd(data, status.id);
        return patchRow(data, 'items', item.id, {
          statusId: status.id,
          rank,
          completedAt: status.kind === 'done' ? item.completedAt || stamp : '',
        });
      },
      send: (ctx) =>
        this.transport.call('item.move', {
          id: ctx.resolve(id),
          statusId: ctx.resolve(statusId),
          ...(afterId ? { afterId: ctx.resolve(afterId) } : {}),
          ...(beforeId ? { beforeId: ctx.resolve(beforeId) } : {}),
          ...this.guard(ctx, 'items', id),
        }),
      commit: (result) => {
        const { item, renumbered } = result as { item: PlanItem; renumbered: { id: string; rank: number }[] };
        return (data) => applyRenumbered(upsertRows(data, { items: [item] }), renumbered ?? []);
      },
    });
  }

  archiveItem(id: string, archived: boolean): void {
    const stamp = this.now();
    this.enqueue({
      table: 'items',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => patchRow(data, 'items', r(id), { archivedAt: archived ? stamp : '' }),
      send: (ctx) => this.transport.call('item.archive', { id: ctx.resolve(id), archived, ...this.guard(ctx, 'items', id) }),
      commit: (result) => (data) => upsertRows(data, { items: [(result as { item: PlanItem }).item] }),
    });
  }

  deleteItem(id: string): void {
    this.enqueue({
      table: 'items',
      rowId: id,
      needs: [id],
      creates: [],
      onConflict: 'dialog',
      optimistic: (data, r) => removeRows(data, 'items', [r(id)]),
      send: (ctx) => this.transport.call('item.delete', { id: ctx.resolve(id), ...this.guard(ctx, 'items', id) }),
      commit: (_result, ctx) => (data) => removeRows(data, 'items', [ctx.resolve(id)]),
    });
  }

  private guard(ctx: SendContext, table: PlanTable, id: string): Record<string, unknown> {
    return ctx.force ? { force: true } : { baseUpdatedAt: ctx.base(table, id) };
  }
}
