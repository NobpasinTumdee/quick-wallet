import { ArrowDown, ArrowUp, CalendarClock, CheckCircle2, ChevronDown, Flag, GripVertical, MoreHorizontal, Plus } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx, formatDate, todayKey } from '../../lib/format';
import { DESCRIPTION_MAX } from '../../lib/planning/cardFields';
import { milestoneAllDone, milestoneProgress, milestonesOf, reorderValue } from '../../lib/planning/milestones';
import { dueTag } from '../../lib/planning/model';
import type { PlanningStore } from '../../lib/planning/store';
import { useSettings } from '../../state/SettingsContext';
import type { PlanMilestone, PlanningData, PlanProject } from '../../types/planning';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { MarkdownField, type MarkdownMode } from '../notes/MarkdownField';
import { Button, EmptyState, Field, Input, Modal, ProgressBar } from '../ui';

const TITLE_MAX = 200;

/**
 * A project's Milestones view: open milestones in their order, closed ones
 * folded away. A row shows the due date (no tag once closed), progress over
 * the cards on the board and done / total; tapping it shows those cards on
 * the board or table, filtered. Reorder: ↑ / ↓ on touch, the handle on
 * desktop, Alt + ↑ / ↓ from the keyboard. Each move is one write.
 */
export function PlanningMilestones({
  data,
  project,
  store,
  onShowCards,
}: {
  data: PlanningData;
  project: PlanProject;
  store: PlanningStore;
  onShowCards: (milestoneId: string) => void;
}) {
  const { t } = useTranslation();
  const { open, closed } = useMemo(() => milestonesOf(data, project.id), [data, project.id]);
  const [closedOpen, setClosedOpen] = useState(false);
  const [editing, setEditing] = useState<PlanMilestone | 'new' | null>(null);
  const [live, setLive] = useState('');
  const listRef = useRef<HTMLOListElement | null>(null);
  const drag = usePointerReorder(listRef, (id, to) => move(id, to));

  /** Moves a milestone to `to` in its section; one write. */
  function move(id: string, to: number, focus = false) {
    const section = open.some((m) => m.id === id) ? open : closed;
    const order = reorderValue(section, id, to);
    if (order === null) return;
    const milestone = section.find((m) => m.id === id);
    store.updateMilestone(id, { order });
    const position = Math.max(0, Math.min(to, section.length - 1)) + 1;
    setLive(t('planning.milestoneMoved', { title: milestone?.title ?? '', position, total: section.length }));
    if (focus) {
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-milestone-main="${CSS.escape(id)}"]`)?.focus(),
      );
    }
  }

  const row = (m: PlanMilestone, index: number, section: PlanMilestone[]) => (
    <MilestoneRow
      key={m.id}
      milestone={m}
      data={data}
      index={index}
      count={section.length}
      dragging={drag.id === m.id}
      onOpen={() => onShowCards(m.id)}
      onEdit={() => setEditing(m)}
      onMove={(to, focus) => move(m.id, to, focus)}
      onClose={() => store.updateMilestone(m.id, { state: 'closed' })}
      onHandleDown={(e) => drag.start(e, m.id)}
    />
  );

  /* While a handle is dragged, the open list in its previewed order. */
  const shownOpen = drag.order ? drag.order.map((id) => open.find((m) => m.id === id)).filter((m): m is PlanMilestone => Boolean(m)) : open;
  const nothing = !open.length && !closed.length;
  return (
    <section className="plan-ms" aria-label={t('planning.milestonesLabel', { name: project.name })}>
      <p className="sr-only" id="plan-ms-help">
        {t('planning.milestoneReorderHelp')}
      </p>
      <div className="sr-only" aria-live="polite" role="status">
        {live}
      </div>

      {nothing ? (
        <EmptyState
          icon={<Icon icon={Flag} size="xl" />}
          title={t('planning.milestonesEmpty')}
          description={t('planning.milestonesEmptyBody')}
        />
      ) : (
        <>
          <h2 className="plan-ms-head">{t('planning.milestonesOpen')}</h2>
          {open.length ? (
            <ol className="plan-ms-list" ref={listRef}>
              {shownOpen.map((m, i, list) => row(m, i, list))}
            </ol>
          ) : (
            <p className="plan-quiet plan-ms-none">{t('planning.milestonesNoOpen')}</p>
          )}
          {closed.length > 0 && (
            <>
              <button type="button" className="plan-ms-fold" aria-expanded={closedOpen} onClick={() => setClosedOpen((v) => !v)}>
                <Icon icon={ChevronDown} size="sm" className={cx('plan-ms-chev', closedOpen && 'is-open')} />
                {t('planning.milestonesClosed', { count: closed.length })}
              </button>
              {closedOpen && <ol className="plan-ms-list plan-ms-list--closed">{closed.map((m, i, list) => row(m, i, list))}</ol>}
            </>
          )}
        </>
      )}

      <div className="plan-ms-foot">
        <Button onClick={() => setEditing('new')}>
          <Icon icon={Plus} size="sm" />
          {t('planning.newMilestone')}
        </Button>
      </div>

      <MilestoneSheet
        milestone={editing === 'new' ? null : editing}
        open={editing !== null}
        project={project}
        data={data}
        store={store}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function MilestoneRow({
  milestone,
  data,
  index,
  count,
  dragging,
  onOpen,
  onEdit,
  onMove,
  onClose,
  onHandleDown,
}: {
  milestone: PlanMilestone;
  data: PlanningData;
  index: number;
  count: number;
  dragging: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onMove: (to: number, focus: boolean) => void;
  onClose: () => void;
  onHandleDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const closed = milestone.state === 'closed';
  const progress = milestoneProgress(data, milestone.id);
  const tag = dueTag(milestone.dueDate, todayKey(), closed);
  const allDone = milestoneAllDone(data, milestone);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(index + (e.key === 'ArrowUp' ? -1 : 1), true);
  };

  return (
    <li className={cx('plan-ms-row', closed && 'is-closed', dragging && 'is-dragging')} data-milestone-id={milestone.id}>
      <div className="plan-ms-line">
        {count > 1 && (
          <span
            className="plan-ms-handle"
            role="presentation"
            title={t('planning.milestoneDrag', { title: milestone.title })}
            onPointerDown={onHandleDown}
          >
            <Icon icon={GripVertical} size="sm" />
          </span>
        )}
        <button
          type="button"
          className="plan-ms-main"
          data-milestone-main={milestone.id}
          aria-label={t('planning.milestoneShowCards', { title: milestone.title })}
          aria-describedby={count > 1 ? 'plan-ms-help' : undefined}
          onClick={onOpen}
          onKeyDown={onKeyDown}
        >
          <span className="plan-ms-title-row">
            <span className="plan-ms-title">{milestone.title}</span>
            {closed && <span className="plan-tag">{t('planning.milestoneClosedTag')}</span>}
            {milestone.dueDate && (
              <span className={cx('plan-tag', tag && `plan-tag--${tag}`)}>
                <Icon icon={CalendarClock} size="sm" />
                {formatDate(milestone.dueDate, settings.locale)}
              </span>
            )}
          </span>
          <span className="plan-ms-progress">
            <ProgressBar
              percent={progress.percent ?? 0}
              label={t('planning.milestoneCardsDone', { done: progress.done, total: progress.total })}
            />
            <span className="plan-ms-count">
              {progress.total ? t('planning.milestoneCardsDone', { done: progress.done, total: progress.total }) : t('planning.noCards')}
            </span>
          </span>
        </button>
        {count > 1 && (
          <span className="plan-ms-moves">
            <button
              type="button"
              className="plan-icon-btn"
              disabled={index === 0}
              aria-label={t('planning.milestoneMoveUp', { title: milestone.title })}
              onClick={() => onMove(index - 1, false)}
            >
              <Icon icon={ArrowUp} size="sm" />
            </button>
            <button
              type="button"
              className="plan-icon-btn"
              disabled={index === count - 1}
              aria-label={t('planning.milestoneMoveDown', { title: milestone.title })}
              onClick={() => onMove(index + 1, false)}
            >
              <Icon icon={ArrowDown} size="sm" />
            </button>
          </span>
        )}
        <button type="button" className="plan-icon-btn" aria-label={t('planning.milestoneMenu', { title: milestone.title })} aria-haspopup="dialog" onClick={onEdit}>
          <Icon icon={MoreHorizontal} size="sm" />
        </button>
      </div>
      {allDone && (
        <div className="plan-ms-alldone">
          <Icon icon={CheckCircle2} size="sm" />
          <span>{t('planning.milestoneAllDone')}</span>
          <Button size="sm" variant="secondary" onClick={onClose}>
            {t('planning.milestoneClose')}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Pointer reordering by the handle (desktop): the row follows as a preview of
 * the list, and only the drop is written. Escape or a lost pointer cancels.
 */
function usePointerReorder(listRef: React.RefObject<HTMLOListElement | null>, onDrop: (id: string, to: number) => void) {
  const [state, setState] = useState<{ id: string; order: string[] } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  function start(e: ReactPointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const list = listRef.current;
    if (!list) return;
    e.preventDefault();
    const order = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-milestone-id]')).map((el) => el.dataset.milestoneId as string);
    const from = order.indexOf(id);
    if (from < 0) return;
    setState({ id, order });

    const onMove = (ev: PointerEvent) => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-milestone-id]'));
      const others = rows.filter((el) => el.dataset.milestoneId !== id);
      let to = others.length;
      for (let i = 0; i < others.length; i += 1) {
        const r = others[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          to = i;
          break;
        }
      }
      const rest = order.filter((x) => x !== id);
      rest.splice(to, 0, id);
      setState((s) => (s && s.order.join() !== rest.join() ? { id, order: rest } : s));
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      const last = stateRef.current;
      setState(null);
      if (commit && last) {
        const to = last.order.indexOf(id);
        if (to !== from) onDrop(id, to);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  }

  return {
    id: state?.id ?? null,
    start,
    /** While dragging: the ids in their previewed order. */
    order: state?.order ?? null,
  };
}

/** Create or edit a milestone: title, due date and description; Close / Reopen and Delete when editing. */
function MilestoneSheet({
  milestone,
  open,
  project,
  data,
  store,
  onClose,
}: {
  milestone: PlanMilestone | null;
  open: boolean;
  project: PlanProject;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<MarkdownMode>('read');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);

  /* Fill the form once per opening (not on every background refresh). */
  const key = open ? (milestone?.id ?? 'new') : null;
  if (key !== seed) {
    setSeed(key);
    if (key) {
      setTitle(milestone?.title ?? '');
      setDueDate(milestone?.dueDate ?? '');
      setDescription(milestone?.description ?? '');
      setMode(milestone?.description ? 'read' : 'edit');
      setTouched(false);
    }
  }

  const cards = milestone ? data.items.filter((i) => i.milestoneId === milestone.id).length : 0;
  const valid = title.trim().length > 0;

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const fields = { title: title.trim(), dueDate, description };
    if (milestone) {
      const changed = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => (milestone as unknown as Record<string, unknown>)[k] !== v),
      );
      if (Object.keys(changed).length) store.updateMilestone(milestone.id, changed);
    } else {
      store.createMilestone(project.id, fields);
    }
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        title={milestone ? t('planning.milestoneEdit') : t('planning.newMilestone')}
        onClose={onClose}
        width={560}
        className="plan-ms-sheet"
        footer={
          <>
            {milestone && (
              <Button
                variant="ghost"
                className="plan-sheet-aside"
                onClick={() => {
                  store.updateMilestone(milestone.id, { state: milestone.state === 'closed' ? 'open' : 'closed' });
                  onClose();
                }}
              >
                {milestone.state === 'closed' ? t('planning.milestoneReopen') : t('planning.milestoneClose')}
              </Button>
            )}
            {milestone && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save}>
              {milestone ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label={t('planning.milestoneFieldTitle')} className="span-2" error={touched && !valid ? t('planning.milestoneTitleRequired') : undefined}>
            <Input value={title} maxLength={TITLE_MAX} autoFocus={!milestone} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('planning.fieldDue')} className="span-2">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <div className="field span-2 plan-ms-desc">
            <span className="field-label">{t('planning.fieldDescription')}</span>
            {!description && mode === 'read' ? (
              <button type="button" className="plan-desc-empty" onClick={() => setMode('edit')}>
                {t('planning.addDescription')}
              </button>
            ) : (
              <MarkdownField
                value={description}
                onChange={setDescription}
                mode={mode}
                onModeChange={setMode}
                max={DESCRIPTION_MAX}
                placeholder={t('planning.descriptionPlaceholder')}
                ariaLabel={t('planning.fieldDescription')}
                noteExists={() => true}
                otherNotes={[]}
                bodyClassName="note-body plan-desc-body"
                readClassName="note-read plan-desc-read"
                skeletonPage="planning"
                rows={5}
              />
            )}
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={t('planning.milestoneDeleteTitle', { title: milestone?.title ?? '' })}
        body={cards ? t('planning.milestoneDeleteBody', { count: cards }) : t('planning.milestoneDeleteBodyNone')}
        confirmLabel={t('planning.milestoneDelete')}
        onConfirm={() => {
          if (milestone) store.deleteMilestone(milestone.id);
          setConfirmDelete(false);
          onClose();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
