import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FileText,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useExcelDB } from '../../hooks/useExcelDB';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useNotes } from '../../hooks/useNotes';
import { cx, formatDate, todayKey } from '../../lib/format';
import {
  budgetFromInput,
  budgetLeft,
  CHECK_LEN,
  checklistAdd,
  checklistEdit,
  CHECKLIST_MAX,
  checklistMove,
  checklistMoveTo,
  checklistRemove,
  checklistToggle,
  datesInOrder,
  DESCRIPTION_MAX,
  DESCRIPTION_WARN,
  LINKS_MAX,
  TITLE_MAX,
} from '../../lib/planning/cardFields';
import { projectLabels } from '../../lib/planning/filters';
import { checklistProgress, dueTag, statusesOf } from '../../lib/planning/model';
import type { PlanningStore, WriteOutcome } from '../../lib/planning/store';
import { toast } from '../../lib/toast';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { Transaction, WalletBalance } from '../../types';
import type { PlanChecklistEntry, PlanItem, PlanPriority } from '../../types/planning';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { MarkdownField, type MarkdownMode } from '../notes/MarkdownField';
import { TransactionForm, type TransactionPayload } from '../TransactionForm';
import { Button, DecimalInput, Field, Input, Modal, ProgressBar, Select } from '../ui';
import { ExpensePicker, LabelEditor, LabelSheet, MilestoneSheet, NotePicker, txLabel } from './CardPickers';
import type { CardSheetProps } from './PlanningBoard';

const PRIORITIES: PlanPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];
const PHONE = '(max-width: 639px)';
const DESCRIPTION_DEBOUNCE = 1000;
const SECTIONS_KEY = 'quick-wallet.planning.sections';

type SectionId = 'details' | 'checklist' | 'budget' | 'note';

function readSections(): Partial<Record<SectionId, boolean>> {
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<SectionId, boolean>>) : {};
  } catch {
    return {};
  }
}

function writeSections(value: Partial<Record<SectionId, boolean>>): void {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(value));
  } catch {
    /* Private mode: the sections just open as they would by default. */
  }
}

/**
 * The full card sheet (round 2). On a phone it is a full-height sheet with a
 * sticky header and footer; each field saves as it changes, the description
 * after a pause in typing. Passed to the board as `renderCardSheet`.
 */
export function CardDetailSheet(props: CardSheetProps) {
  if (!props.item) return null;
  return <DetailSheet {...props} item={props.item} />;
}

function DetailSheet({ item, data, store, onClose, onMoveTo }: CardSheetProps & { item: PlanItem }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const phone = useMediaQuery(PHONE);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const conflictOpen = Boolean(state.conflict);

  const itemRef = useRef(item);
  itemRef.current = item;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    /* Lets the Markdown bar docked above a phone keyboard sit over the sheet. */
    document.documentElement.classList.add('plan-sheet-open');
    return () => {
      mounted.current = false;
      document.documentElement.classList.remove('plan-sheet-open');
    };
  }, []);

  const save = useCallback(
    (fields: Partial<PlanItem>) => store.updateItem(itemRef.current.id, fields),
    [store],
  );

  /* ---- Title: saved on Enter or leaving the field ---- */

  const [title, setTitle] = useState(item.title);
  const titleFocused = useRef(false);
  useEffect(() => {
    if (!titleFocused.current) setTitle(item.title);
  }, [item.title]);
  const commitTitle = () => {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    if (!clean) {
      setTitle(itemRef.current.title);
      return;
    }
    if (clean !== itemRef.current.title) save({ title: clean });
    setTitle(clean);
  };

  /* ---- Description: a pause in typing saves it ---- */

  const draftKey = `description:${item.id}`;
  const [desc, setDesc] = useState(item.description);
  const [descMode, setDescMode] = useState<MarkdownMode>('read');
  const [descState, setDescState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const descRef = useRef(desc);
  descRef.current = desc;
  const timer = useRef(0);
  /** The text last handed to the queue (what the server will hold once it answers). */
  const sentRef = useRef(item.description);
  const failedRef = useRef(false);

  const settled = useCallback(
    (text: string) => (outcome: WriteOutcome) => {
      if (outcome === 'saved') {
        if (mounted.current && sentRef.current === text) setDescState('saved');
        return;
      }
      if (outcome === 'failed') {
        if (mounted.current) {
          failedRef.current = true;
          setDescState('failed');
          return;
        }
        toast.error(t('planning.descFailedClosed'), t('planning.saveFailed'), {
          duration: 15000,
          action: {
            label: t('planning.copyText'),
            onClick: () => void navigator.clipboard?.writeText(text).catch(() => undefined),
          },
        });
        return;
      }
      /* Dropped: the user chose the other device's version (or the card went). */
      if (mounted.current) {
        sentRef.current = itemRef.current.description;
        setDesc(itemRef.current.description);
        setDescState('idle');
      }
    },
    [t],
  );

  const flushDesc = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    store.setDraft(draftKey, false);
    const text = descRef.current;
    if (text === sentRef.current && !failedRef.current) return;
    failedRef.current = false;
    sentRef.current = text;
    if (mounted.current) setDescState('saving');
    store.updateItem(itemRef.current.id, { description: text }, { silent: true, settled: settled(text) });
  }, [draftKey, settled, store]);

  const changeDesc = (text: string) => {
    setDesc(text);
    store.setDraft(draftKey, true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flushDesc, DESCRIPTION_DEBOUNCE);
  };

  /* Closing (✕, Back, the backdrop) or leaving the page sends what is typed. */
  useEffect(() => () => flushDesc(), [flushDesc]);

  /* The server's text, when nothing local is waiting (another device, "Use latest"). */
  useEffect(() => {
    if (timer.current || failedRef.current) return;
    if (item.description !== sentRef.current) {
      sentRef.current = item.description;
      setDesc(item.description);
    }
  }, [item.description]);

  const close = () => {
    flushDesc();
    onClose();
  };

  /* ---- The rest of the fields save at once ---- */

  const statuses = statusesOf(data, item.projectId);
  const status = statuses.find((s) => s.id === item.statusId);
  const done = status?.kind === 'done';
  const milestones = useMemo(
    () => data.milestones.filter((m) => m.projectId === item.projectId).sort((a, b) => a.order - b.order),
    [data.milestones, item.projectId],
  );
  const milestone = milestones.find((m) => m.id === item.milestoneId);
  const known = useMemo(() => projectLabels(data, item.projectId), [data, item.projectId]);

  const [start, setStart] = useState(item.startDate);
  const [due, setDue] = useState(item.dueDate);
  useEffect(() => setStart(item.startDate), [item.startDate]);
  useEffect(() => setDue(item.dueDate), [item.dueDate]);
  const datesOk = datesInOrder(start, due);
  const changeDate = (which: 'startDate' | 'dueDate', value: string) => {
    const nextStart = which === 'startDate' ? value : start;
    const nextDue = which === 'dueDate' ? value : due;
    if (which === 'startDate') setStart(value);
    else setDue(value);
    if (!datesInOrder(nextStart, nextDue)) return;
    const fields: Partial<PlanItem> = {};
    if (nextStart !== itemRef.current.startDate) fields.startDate = nextStart;
    if (nextDue !== itemRef.current.dueDate) fields.dueDate = nextDue;
    if (Object.keys(fields).length) save(fields);
  };
  const tag = dueTag(item.dueDate, todayKey(), done);

  const [sheet, setSheet] = useState<'labels' | 'milestone' | 'expenses' | 'note' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* ---- Sections ---- */

  const [sections, setSections] = useState(readSections);
  const isOpen = (id: SectionId, hasContent: boolean) => sections[id] ?? (id === 'details' || hasContent);
  const toggle = (id: SectionId, hasContent: boolean) => {
    const next = { ...sections, [id]: !isOpen(id, hasContent) };
    setSections(next);
    writeSections(next);
  };

  const checklist = checklistProgress(item);
  const hasBudget = item.budget !== null || item.linkedTxIds.length > 0;

  const titleId = useId();
  const nearTitle = title.length >= TITLE_MAX - 20;
  const nearDesc = desc.length >= DESCRIPTION_WARN;

  return (
    <>
      <Modal
        open
        title={status ? status.name : t('planning.editCard')}
        onClose={close}
        width={720}
        className="plan-detail"
        footer={
          <>
            <Button
              size="sm"
              onClick={() => {
                close();
                onMoveTo(item.id);
              }}
            >
              {t('planning.moveTo')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                flushDesc();
                store.archiveItem(item.id, !item.archivedAt);
                if (!item.archivedAt) onClose();
              }}
            >
              {item.archivedAt ? t('planning.unarchive') : t('common.archive')}
            </Button>
            <Button size="sm" variant="danger" className="plan-foot-end" onClick={() => setConfirmDelete(true)}>
              <Icon icon={Trash2} size="sm" />
              <span className="plan-foot-label">{t('common.delete')}</span>
            </Button>
          </>
        }
      >
        <div className="plan-detail-body">
          {item.archivedAt && (
            <p className="plan-banner" role="status">
              {t('planning.archivedBanner', { date: formatDate(item.archivedAt.slice(0, 10), settings.locale) })}
            </p>
          )}

          <div className="plan-title-field">
            <label className="sr-only" htmlFor={titleId}>
              {t('planning.fieldTitle')}
            </label>
            <textarea
              id={titleId}
              className="plan-title-input"
              value={title}
              rows={1}
              maxLength={TITLE_MAX}
              enterKeyHint="done"
              onFocus={() => {
                titleFocused.current = true;
              }}
              onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                titleFocused.current = false;
                commitTitle();
              }}
              ref={(el) => {
                if (!el) return;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
            />
            {nearTitle && <span className="plan-counter">{t('planning.counter', { count: title.length, max: TITLE_MAX })}</span>}
          </div>

          <div className="plan-chips-row" role="group" aria-label={t('planning.fieldPriority')}>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={item.priority === p}
                className={cx('plan-prio-chip', item.priority === p && 'is-active')}
                onClick={() => item.priority !== p && save({ priority: p })}
              >
                {p !== 'none' && <span className={`plan-prio plan-prio--${p}`} aria-hidden="true" />}
                {t(`planning.priority_${p}`)}
              </button>
            ))}
          </div>

          {/* ---- Description ---- */}
          <section className="plan-desc" aria-label={t('planning.fieldDescription')}>
            <div className="plan-desc-head">
              <h3 className="plan-desc-title">{t('planning.fieldDescription')}</h3>
              <DescStatus state={descState} onRetry={flushDesc} />
              {desc && (
                <Button size="sm" variant="ghost" onClick={() => (descMode === 'edit' ? setDescMode('read') : setDescMode('edit'))}>
                  {descMode === 'edit' ? t('planning.done') : (
                    <>
                      <Icon icon={Pencil} size="sm" />
                      {t('common.edit')}
                    </>
                  )}
                </Button>
              )}
            </div>
            {!desc && descMode === 'read' ? (
              <button type="button" className="plan-desc-empty" onClick={() => setDescMode('edit')}>
                {t('planning.addDescription')}
              </button>
            ) : (
              <MarkdownField
                value={desc}
                onChange={changeDesc}
                mode={descMode}
                onModeChange={setDescMode}
                max={DESCRIPTION_MAX}
                placeholder={t('planning.descriptionPlaceholder')}
                ariaLabel={t('planning.fieldDescription')}
                noteExists={() => true}
                otherNotes={[]}
                tasksDisabled={conflictOpen}
                bodyClassName="note-body plan-desc-body"
                readClassName="note-read plan-desc-read"
                skeletonPage="planning"
                rows={6}
              />
            )}
            {nearDesc && (
              <p className={cx('plan-hint', desc.length >= DESCRIPTION_MAX && 'plan-hint--error')}>
                {t('planning.counter', { count: desc.length.toLocaleString(settings.locale), max: DESCRIPTION_MAX.toLocaleString(settings.locale) })}
              </p>
            )}
          </section>

          {/* ---- Details ---- */}
          <Section id="details" title={t('planning.sectionDetails')} open={isOpen('details', true)} onToggle={() => toggle('details', true)}>
            <div className="plan-fields">
              <Field label={t('planning.fieldStatus')}>
                <Select value={item.statusId} onChange={(e) => save({ statusId: e.target.value })}>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="field">
                <span className="field-label">{t('planning.fieldMilestone')}</span>
                <button type="button" className="control plan-picker-field" onClick={() => setSheet('milestone')}>
                  <span className={cx('plan-grow', !milestone && 'plan-quiet')}>{milestone?.title ?? t('planning.noMilestone')}</span>
                  <Icon icon={ChevronDown} size="sm" />
                </button>
              </div>

              <Field label={t('planning.fieldStart')}>
                <Input type="date" value={start} max={due || undefined} onChange={(e) => changeDate('startDate', e.target.value)} />
              </Field>
              <Field
                label={
                  <span className="plan-label-row">
                    {t('planning.fieldDue')}
                    {item.dueDate && tag && <span className={cx('plan-tag', `plan-tag--${tag}`)}>{t(`planning.tag_${tag}`)}</span>}
                  </span>
                }
                error={datesOk ? undefined : t('planning.dueBeforeStart')}
              >
                <Input type="date" value={due} min={start || undefined} aria-invalid={!datesOk || undefined} onChange={(e) => changeDate('dueDate', e.target.value)} />
              </Field>

              <div className="field span-2">
                <span className="field-label">{t('planning.fieldLabels')}</span>
                {phone ? (
                  <button type="button" className="control plan-picker-field plan-picker-field--chips" onClick={() => setSheet('labels')}>
                    {item.labels.length ? (
                      <span className="plan-labels">
                        {item.labels.map((label) => (
                          <span key={label} className="plan-label">
                            {label}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="plan-grow plan-quiet">{t('planning.addLabel')}</span>
                    )}
                    <Icon icon={Plus} size="sm" />
                  </button>
                ) : (
                  <LabelEditor labels={item.labels} known={known} onChange={(labels) => save({ labels })} />
                )}
              </div>
            </div>
          </Section>

          {/* ---- Checklist ---- */}
          <Section
            id="checklist"
            title={t('planning.sectionChecklist')}
            summary={checklist ? `${checklist.done}/${checklist.total}` : undefined}
            open={isOpen('checklist', item.checklist.length > 0)}
            onToggle={() => toggle('checklist', item.checklist.length > 0)}
          >
            <ChecklistEditor list={item.checklist} phone={phone} onChange={(list) => save({ checklist: list })} />
          </Section>

          {/* ---- Budget & expenses ---- */}
          <Section
            id="budget"
            title={t('planning.sectionBudget')}
            open={isOpen('budget', hasBudget)}
            onToggle={() => toggle('budget', hasBudget)}
          >
            <BudgetEditor item={item} onSave={(budget) => save({ budget })} />
            <LinkedExpenses
              item={item}
              store={store}
              onUnlink={(id) => save({ linkedTxIds: item.linkedTxIds.filter((x) => x !== id) })}
              onPick={() => setSheet('expenses')}
            />
          </Section>

          {/* ---- Linked note ---- */}
          <Section
            id="note"
            title={t('planning.sectionNote')}
            open={isOpen('note', Boolean(item.linkedNoteId))}
            onToggle={() => toggle('note', Boolean(item.linkedNoteId))}
          >
            <LinkedNote item={item} onPick={() => setSheet('note')} onUnlink={() => save({ linkedNoteId: '' })} onLeave={close} />
          </Section>

          <p className="plan-stamps">
            <span>{t('planning.created', { date: formatDate(item.createdAt.slice(0, 10), settings.locale) })}</span>
            <span>{t('planning.updated', { date: formatDate(item.updatedAt.slice(0, 10), settings.locale) })}</span>
            {item.completedAt && <span>{t('planning.completed', { date: formatDate(item.completedAt.slice(0, 10), settings.locale) })}</span>}
          </p>
        </div>
      </Modal>

      <LabelSheet open={sheet === 'labels'} labels={item.labels} known={known} onChange={(labels) => save({ labels })} onClose={() => setSheet(null)} />
      <MilestoneSheet
        open={sheet === 'milestone'}
        projectId={item.projectId}
        milestones={milestones}
        value={item.milestoneId}
        store={store}
        onPick={(id) => id !== item.milestoneId && save({ milestoneId: id })}
        onClose={() => setSheet(null)}
      />
      {sheet === 'expenses' && (
        <ExpensePickerHost
          linked={item.linkedTxIds}
          onToggle={(id) => {
            const on = itemRef.current.linkedTxIds.includes(id);
            if (!on && itemRef.current.linkedTxIds.length >= LINKS_MAX) return;
            save({ linkedTxIds: on ? itemRef.current.linkedTxIds.filter((x) => x !== id) : [...itemRef.current.linkedTxIds, id] });
          }}
          onClose={() => setSheet(null)}
        />
      )}
      <NotePicker open={sheet === 'note'} value={item.linkedNoteId} onPick={(id) => save({ linkedNoteId: id })} onClose={() => setSheet(null)} />
      <ConfirmDialog
        open={confirmDelete}
        title={t('planning.deleteCardTitle')}
        body={t('planning.deleteCardBody', { title: item.title })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          window.clearTimeout(timer.current);
          timer.current = 0;
          store.setDraft(draftKey, false);
          sentRef.current = descRef.current;
          store.deleteItem(item.id);
          setConfirmDelete(false);
          onClose();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

function DescStatus({ state, onRetry }: { state: 'idle' | 'saving' | 'saved' | 'failed'; onRetry: () => void }) {
  const { t } = useTranslation();
  if (state === 'failed') {
    return (
      <span className="plan-desc-state is-failed" role="alert">
        <Icon icon={AlertTriangle} size="sm" />
        {t('planning.descFailed')}
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <Icon icon={RotateCcw} size="sm" />
          {t('common.tryAgain')}
        </Button>
      </span>
    );
  }
  if (state === 'idle') return <span className="plan-desc-state" />;
  return (
    <span className="plan-desc-state" aria-live="polite">
      {state === 'saving' ? t('planning.saving') : t('common.saved')}
    </span>
  );
}

/* ---- A collapsible section ---- */

function Section({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `plan-section-${id}`;
  return (
    <section className={cx('plan-section', open && 'is-open')}>
      <h3 className="plan-section-head">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="plan-grow">{title}</span>
          {summary && <span className="plan-section-sum">{summary}</span>}
          <Icon icon={ChevronDown} size="sm" className="plan-section-caret" />
        </button>
      </h3>
      <div id={bodyId} className="plan-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/* ---- Checklist ---- */

function ChecklistEditor({
  list,
  phone,
  onChange,
}: {
  list: PlanChecklistEntry[];
  phone: boolean;
  onChange: (list: PlanChecklistEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; index: number } | null>(null);
  const done = list.filter((c) => c.done).length;
  const full = list.length >= CHECKLIST_MAX;
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const list = listRef.current;
    const handle = list?.querySelector<HTMLElement>(`[data-check-move="${CSS.escape(id)}"]:not(:disabled)`);
    /* An arrow that can no longer move it (now first or last) hands focus to the text. */
    (handle ?? list?.querySelector<HTMLElement>(`[data-check-id="${CSS.escape(id)}"] .plan-check-text`))?.focus();
  });

  const add = () => {
    const next = checklistAdd(list, text);
    if (!next) return;
    onChange(next);
    setText('');
    addRef.current?.focus();
  };

  const move = (id: string, delta: number, refocus: string) => {
    const next = checklistMove(list, id, delta);
    if (next === list) return;
    pendingFocus.current = refocus;
    onChange(next);
  };

  /* Desktop: drag by the handle. The list is drawn in the dropped order while dragging. */
  const shown = useMemo(() => (drag ? checklistMoveTo(list, drag.id, drag.index) : list), [drag, list]);
  const onHandleDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    let current = { id, index: list.findIndex((c) => c.id === id) };
    setDrag(current);
    const onMove = (e: PointerEvent) => {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-check-id]') ?? []).filter(
        (row) => row.dataset.checkId !== id,
      );
      const index = rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.top + r.height / 2 < e.clientY;
      }).length;
      if (index !== current.index) {
        current = { id, index };
        setDrag(current);
      }
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      setDrag(null);
      const next = checklistMoveTo(list, id, current.index);
      if (next !== list) onChange(next);
    };
    const onCancel = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      setDrag(null);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  };

  return (
    <div className="plan-check">
      {list.length > 0 && (
        <div className="plan-check-progress">
          <ProgressBar percent={(done / list.length) * 100} label={t('planning.checklistDone', { done, total: list.length })} />
          <span className="plan-check-count">
            {done}/{list.length}
          </span>
        </div>
      )}
      <ul className="plan-check-list" ref={listRef}>
        {shown.map((entry, index) => (
          <ChecklistRow
            key={entry.id}
            entry={entry}
            first={index === 0}
            last={index === shown.length - 1}
            phone={phone}
            dragging={drag?.id === entry.id}
            onToggle={() => onChange(checklistToggle(list, entry.id))}
            onEdit={(value) => {
              const clean = value.trim();
              if (!clean) onChange(checklistRemove(list, entry.id));
              else if (clean !== entry.text) onChange(checklistEdit(list, entry.id, clean));
            }}
            onRemove={() => onChange(checklistRemove(list, entry.id))}
            onMove={(delta, refocus) => move(entry.id, delta, refocus)}
            onHandleDown={(e) => onHandleDown(e, entry.id)}
          />
        ))}
      </ul>
      {full ? (
        <p className="plan-hint">{t('planning.checklistFull', { max: CHECKLIST_MAX })}</p>
      ) : (
        <form
          className="plan-check-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            ref={addRef}
            className="control"
            value={text}
            maxLength={CHECK_LEN}
            placeholder={t('planning.addChecklistItem')}
            aria-label={t('planning.addChecklistItem')}
            enterKeyHint="enter"
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            <Icon icon={Plus} size="sm" />
            <span className="plan-foot-label">{t('common.add')}</span>
          </Button>
        </form>
      )}
      {!full && list.length >= CHECKLIST_MAX - 10 && (
        <p className="plan-hint">{t('planning.checklistLeft', { count: CHECKLIST_MAX - list.length })}</p>
      )}
      {text.length >= CHECK_LEN - 30 && <p className="plan-hint">{t('planning.charsLeft', { count: CHECK_LEN - text.length })}</p>}
    </div>
  );
}

function ChecklistRow({
  entry,
  first,
  last,
  phone,
  dragging,
  onToggle,
  onEdit,
  onRemove,
  onMove,
  onHandleDown,
}: {
  entry: PlanChecklistEntry;
  first: boolean;
  last: boolean;
  phone: boolean;
  dragging: boolean;
  onToggle: () => void;
  onEdit: (text: string) => void;
  onRemove: () => void;
  onMove: (delta: number, refocus: string) => void;
  onHandleDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(entry.text);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setValue(entry.text);
  }, [entry.text]);

  /* Alt+↑ / Alt+↓ moves the entry from its text or its handle. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    if (event.currentTarget instanceof HTMLInputElement) onEdit(event.currentTarget.value);
    onMove(event.key === 'ArrowUp' ? -1 : 1, entry.id);
  };

  return (
    <li className={cx('plan-check-row', entry.done && 'is-done', dragging && 'is-dragging')} data-check-id={entry.id}>
      {!phone && (
        <button
          type="button"
          className="plan-check-grab"
          data-check-move={entry.id}
          aria-label={t('planning.moveChecklistItem', { text: entry.text })}
          title={t('planning.moveChecklistHint')}
          onPointerDown={onHandleDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onMove(e.key === 'ArrowUp' ? -1 : 1, entry.id);
            }
          }}
        >
          <Icon icon={GripVertical} size="sm" />
        </button>
      )}
      <input
        type="checkbox"
        className="plan-check-box"
        checked={entry.done}
        aria-label={t('planning.checkItem', { text: entry.text })}
        onChange={onToggle}
      />
      <input
        className="plan-check-text"
        value={value}
        maxLength={CHECK_LEN}
        aria-label={t('planning.checklistItemText')}
        enterKeyHint="done"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setValue(entry.text);
            focused.current = false;
            e.currentTarget.blur();
            return;
          }
          onKeyDown(e);
        }}
        onBlur={() => {
          if (!focused.current) return;
          focused.current = false;
          onEdit(value);
        }}
      />
      {phone && (
        <span className="plan-check-moves">
          <button
            type="button"
            className="plan-icon-btn"
            data-check-move={first ? undefined : entry.id}
            disabled={first}
            aria-label={t('planning.moveUp', { text: entry.text })}
            onClick={() => onMove(-1, entry.id)}
          >
            <Icon icon={ArrowUp} size="sm" />
          </button>
          <button
            type="button"
            className="plan-icon-btn"
            disabled={last}
            aria-label={t('planning.moveDown', { text: entry.text })}
            onClick={() => onMove(1, entry.id)}
          >
            <Icon icon={ArrowDown} size="sm" />
          </button>
        </span>
      )}
      <button type="button" className="plan-icon-btn" aria-label={t('planning.removeChecklistItem', { text: entry.text })} onClick={onRemove}>
        <Icon icon={X} size="sm" />
      </button>
    </li>
  );
}

/* ---- Budget ---- */

function budgetInput(value: number | null): string {
  return value === null ? '' : String(value);
}

function BudgetEditor({ item, onSave }: { item: PlanItem; onSave: (budget: number | null) => void }) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const [raw, setRaw] = useState(budgetInput(item.budget));
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setRaw(budgetInput(item.budget));
  }, [item.budget]);

  const commit = (value = raw) => {
    editing.current = false;
    const parsed = budgetFromInput(value);
    if (parsed.error) {
      setError(t(`planning.budget_${parsed.error}`));
      return;
    }
    setError(null);
    if (parsed.value !== item.budget) onSave(parsed.value);
    setRaw(budgetInput(parsed.value));
  };

  const left = budgetLeft(item.budget, item.spent);

  return (
    <div className="plan-budget">
      <Field label={t('planning.fieldBudget')} hint={t('planning.budgetHint')} error={error ?? undefined}>
        <DecimalInput
          value={raw}
          onChange={(value) => {
            editing.current = true;
            setRaw(value);
            setError(null);
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={t('planning.noBudget')}
          aria-label={t('planning.fieldBudget')}
        />
      </Field>
      <dl className="plan-budget-sum">
        <div>
          <dt>{t('planning.spent')}</dt>
          <dd>{money(item.spent)}</dd>
        </div>
        {left && (
          <div className={cx(left.over && 'is-over')}>
            <dt>{left.over ? t('planning.overBudget') : t('planning.remaining')}</dt>
            <dd>{money(Math.abs(left.remaining))}</dd>
          </div>
        )}
      </dl>
      {left && (
        <ProgressBar
          percent={left.percent}
          tone={left.over ? 'over' : left.percent >= 90 ? 'warning' : 'ok'}
          label={t('planning.budgetUsed', { percent: left.percent })}
        />
      )}
    </div>
  );
}

/* ---- Linked expenses ---- */

/** The newest 2,000 transactions: what the linked rows are looked up in. */
const TX_LOOKUP = { limit: 2000 };

function LinkedExpenses({
  item,
  store,
  onUnlink,
  onPick,
}: {
  item: PlanItem;
  store: PlanningStore;
  onUnlink: (id: string) => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const wanted = item.linkedTxIds.length > 0;
  const transactions = useExcelDB<Transaction>('transactions', TX_LOOKUP, { enabled: wanted });
  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true }, { enabled: wanted });
  const [editing, setEditing] = useState<Transaction | null>(null);
  const missing = new Set(item.missingTxIds);
  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? '';
  const full = item.linkedTxIds.length >= LINKS_MAX;

  const rows = item.linkedTxIds
    .map((id) => ({ id, tx: transactions.items.find((x) => x.id === id) ?? null }))
    .sort((a, b) => (b.tx?.date ?? '').localeCompare(a.tx?.date ?? ''));

  const save = (payload: TransactionPayload) => {
    if (!editing) return Promise.resolve();
    const pending = transactions.update(editing.id, payload);
    setEditing(null);
    /* Spent is the server's sum: read it again once the edit lands. */
    pending.then(() => store.load(true)).catch(() => undefined);
    return Promise.resolve();
  };

  return (
    <div className="plan-linked">
      <div className="plan-linked-head">
        <h4>{t('planning.linkedExpenses')}</h4>
        <Button size="sm" onClick={onPick} disabled={full}>
          <Icon icon={Link2} size="sm" />
          {t('planning.linkExpenseEllipsis')}
        </Button>
      </div>
      {full && <p className="plan-hint">{t('planning.linksFull', { max: LINKS_MAX })}</p>}
      {rows.length === 0 ? (
        <p className="plan-quiet">{t('planning.noLinkedExpenses')}</p>
      ) : (
        <ul className="plan-tx-list">
          {rows.map(({ id, tx }) => {
            if (missing.has(id) || (!tx && !transactions.loading)) {
              const gone = missing.has(id);
              return (
                <li key={id} className="plan-tx plan-tx--static">
                  <span className="plan-tx-check plan-tx-check--icon" aria-hidden="true">
                    <Icon icon={gone ? AlertTriangle : Receipt} size="sm" />
                  </span>
                  <span className="plan-tx-body">
                    <span className="plan-tx-title">{gone ? t('planning.deletedTransaction') : t('planning.olderTransaction')}</span>
                    <span className="plan-tx-meta">{gone ? t('planning.deletedTransactionHint') : t('planning.olderTransactionHint')}</span>
                  </span>
                  <button type="button" className="plan-icon-btn" aria-label={t('planning.unlinkExpense')} onClick={() => onUnlink(id)}>
                    <Icon icon={X} size="sm" />
                  </button>
                </li>
              );
            }
            if (!tx) return <li key={id} className="plan-tx-sk" aria-hidden="true" />;
            return (
              <li key={id} className="plan-tx-item">
                <button type="button" className="plan-tx" onClick={() => setEditing(tx)}>
                  <span className="plan-tx-check plan-tx-check--icon" aria-hidden="true">
                    <Icon icon={Receipt} size="sm" />
                  </span>
                  <span className="plan-tx-body">
                    <span className="plan-tx-title">{txLabel(tx, t('planning.expense'))}</span>
                    <span className="plan-tx-meta">
                      {formatDate(tx.date, settings.locale)}
                      {walletName(tx.walletId) && ` · ${walletName(tx.walletId)}`}
                      {tx.note.trim() && tx.category && ` · ${tx.category}`}
                    </span>
                  </span>
                  <span className="plan-tx-amount">{money(tx.amount)}</span>
                </button>
                <button
                  type="button"
                  className="plan-icon-btn"
                  aria-label={t('planning.unlinkNamed', { name: txLabel(tx, t('planning.expense')) })}
                  onClick={() => onUnlink(id)}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <TransactionForm
        open={editing !== null}
        wallets={wallets.items.filter((w) => !w.archived)}
        transaction={editing ?? undefined}
        busy={transactions.mutating}
        error={transactions.mutationError}
        onClose={() => {
          setEditing(null);
          transactions.clearMutationError();
        }}
        onSubmit={save}
      />
    </div>
  );
}

function ExpensePickerHost({ linked, onToggle, onClose }: { linked: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true });
  return <ExpensePicker open linked={linked} wallets={wallets.items} onToggle={onToggle} onClose={onClose} />;
}

/* ---- Linked note ---- */

function LinkedNote({
  item,
  onPick,
  onUnlink,
  onLeave,
}: {
  item: PlanItem;
  onPick: () => void;
  onUnlink: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const notes = useNotes({ enabled: Boolean(item.linkedNoteId) && !item.linkedNoteMissing });
  const note = notes.items.find((n) => n.id === item.linkedNoteId);

  if (!item.linkedNoteId) {
    return (
      <div className="plan-linked">
        <p className="plan-quiet">{t('planning.noLinkedNote')}</p>
        <Button size="sm" onClick={onPick}>
          <Icon icon={FileText} size="sm" />
          {t('planning.linkNoteEllipsis')}
        </Button>
      </div>
    );
  }
  const gone = item.linkedNoteMissing;
  return (
    <div className="plan-linked">
      <div className="plan-tx plan-tx--static">
        <span className="plan-tx-check plan-tx-check--icon" aria-hidden="true">
          <Icon icon={gone ? AlertTriangle : FileText} size="sm" />
        </span>
        <span className="plan-tx-body">
          <span className="plan-tx-title">{gone ? t('planning.noteDeleted') : note?.title || (notes.loading ? '…' : t('notes.untitled'))}</span>
        </span>
        {!gone && (
          <a
            className="plan-icon-btn"
            href={`#/notes?id=${encodeURIComponent(item.linkedNoteId)}`}
            aria-label={t('planning.openNote')}
            title={t('planning.openNote')}
            onClick={onLeave}
          >
            <Icon icon={ExternalLink} size="sm" />
          </a>
        )}
        <button type="button" className="plan-icon-btn" aria-label={t('planning.unlinkNote')} title={t('planning.unlinkNote')} onClick={onUnlink}>
          <Icon icon={X} size="sm" />
        </button>
      </div>
      {!gone && (
        <Button size="sm" variant="ghost" onClick={onPick}>
          {t('planning.changeNote')}
        </Button>
      )}
    </div>
  );
}
