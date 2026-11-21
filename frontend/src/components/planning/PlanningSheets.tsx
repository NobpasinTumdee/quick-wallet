import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openPlanning } from '../../lib/router';
import { columnItems, statusesOf } from '../../lib/planning/model';
import type { PlanningConflict, PlanningStore } from '../../lib/planning/store';
import type { PlanItem, PlanKind, PlanningData, PlanPriority, PlanProject, PlanStatus } from '../../types/planning';
import { ConfirmDialog } from '../ConfirmDialog';
import { SWATCHES } from '../GoalForm';
import { Button, Field, Input, Modal, Select, Textarea } from '../ui';
import { archiveColumn } from './PlanningArchived';
import { LinkedGoalField } from './PlanningProjectInfo';

/**
 * The board's sheets. Each takes the store and the row; none of them is
 * referenced by the board's layout, so round 2's full card sheet can replace
 * CardQuickSheet by passing a different `renderCard` to the board.
 */

export const PROJECT_ICONS = ['📋', '🏠', '✈️', '🎯', '💼', '🎉', '🛠️', '📚', '💡', '🌱'];
const PRIORITIES: PlanPriority[] = ['none', 'low', 'medium', 'high', 'urgent'];
const KINDS: PlanKind[] = ['todo', 'doing', 'done'];

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="swatches" role="group" aria-label={label}>
      <button
        type="button"
        className={`swatch plan-swatch-none${!value ? ' is-active' : ''}`}
        aria-pressed={!value}
        aria-label={t('planning.noColor')}
        onClick={() => onChange('')}
      />
      {SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          className={`swatch${value === swatch ? ' is-active' : ''}`}
          style={{ background: swatch }}
          aria-label={swatch}
          aria-pressed={value === swatch}
          onClick={() => onChange(swatch)}
        />
      ))}
    </div>
  );
}

/* ---- Project ---- */

interface ProjectForm {
  name: string;
  description: string;
  color: string;
  icon: string;
  startDate: string;
  dueDate: string;
  linkedGoalId: string;
}

export function ProjectSheet({
  open,
  project,
  data,
  store,
  onClose,
}: {
  open: boolean;
  project: PlanProject | null;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProjectForm>(() => blankProject());
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            name: project.name,
            description: project.description,
            color: project.color,
            icon: project.icon,
            startDate: project.startDate,
            dueDate: project.dueDate,
            linkedGoalId: project.linkedGoalId || '',
          }
        : blankProject(),
    );
  }, [open, project]);

  const cardCount = project ? data.items.filter((i) => i.projectId === project.id).length : 0;
  const datesWrong = Boolean(form.startDate && form.dueDate && form.dueDate < form.startDate);
  const valid = form.name.trim().length > 0 && !datesWrong;
  const patch = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    if (!valid) return;
    const fields = { ...form, name: form.name.trim() };
    if (project) {
      store.updateProject(project.id, fields);
      onClose();
    } else {
      const id = store.createProject(fields, [
        t('planning.defaultPlanning'),
        t('planning.defaultReady'),
        t('planning.defaultInProgress'),
        t('planning.defaultDone'),
      ]);
      onClose();
      openPlanning(id);
    }
  };

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        title={project ? t('planning.editProject') : t('planning.newProject')}
        onClose={onClose}
        footer={
          <>
            {project && (
              <Button
                variant="ghost"
                className="plan-sheet-aside"
                onClick={() => {
                  store.updateProject(project.id, { state: project.state === 'archived' ? 'active' : 'archived' });
                  onClose();
                }}
              >
                {project.state === 'archived' ? t('common.restore') : t('common.archive')}
              </Button>
            )}
            {project && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={!valid}>
              {project ? t('common.save') : t('common.create')}
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
          <Field label={t('planning.fieldName')} className="span-2">
            <Input value={form.name} maxLength={120} autoFocus onChange={(e) => patch('name', e.target.value)} required />
          </Field>
          <Field label={t('planning.fieldDescription')} className="span-2">
            <Textarea rows={3} value={form.description} onChange={(e) => patch('description', e.target.value)} />
          </Field>
          <Field label={t('planning.fieldIcon')} className="span-2">
            <div className="swatches" role="group" aria-label={t('planning.fieldIcon')}>
              {PROJECT_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`swatch plan-swatch-icon${form.icon === icon ? ' is-active' : ''}`}
                  aria-pressed={form.icon === icon}
                  onClick={() => patch('icon', icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('planning.fieldColor')} className="span-2">
            <ColorPicker value={form.color} onChange={(c) => patch('color', c)} label={t('planning.fieldColor')} />
          </Field>
          <Field label={t('planning.fieldStart')}>
            <Input type="date" value={form.startDate} onChange={(e) => patch('startDate', e.target.value)} />
          </Field>
          <Field label={t('planning.fieldDue')} error={datesWrong ? t('planning.dueBeforeStart') : undefined}>
            <Input type="date" value={form.dueDate} onChange={(e) => patch('dueDate', e.target.value)} />
          </Field>
          {/* Not a <label>: it holds buttons, and tapping a label would press the first one. */}
          <div className="field span-2" role="group" aria-labelledby="plan-goal-label">
            <span className="field-label" id="plan-goal-label">
              {t('planning.fieldLinkedGoal')}
            </span>
            <LinkedGoalField
              value={form.linkedGoalId}
              /* The server's flag is about the saved link; a newly picked goal exists. */
              missing={Boolean(project?.linkedGoalMissing && form.linkedGoalId === project.linkedGoalId)}
              onChange={(id) => patch('linkedGoalId', id)}
            />
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title={t('planning.deleteProjectTitle', { name: project?.name ?? '' })}
        body={
          <>
            <p>{t('planning.deleteProjectBody', { count: cardCount })}</p>
            <p>{t('planning.deleteProjectArchiveHint')}</p>
          </>
        }
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (project) store.deleteProject(project.id);
          setConfirmDelete(false);
          onClose();
          openPlanning(null);
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

function blankProject(): ProjectForm {
  return { name: '', description: '', color: '', icon: PROJECT_ICONS[0], startDate: '', dueDate: '', linkedGoalId: '' };
}

/* ---- Status (a column's ⋯ menu) ---- */

export function StatusSheet({
  status,
  data,
  store,
  onClose,
}: {
  status: PlanStatus | null;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [kind, setKind] = useState<PlanKind>('todo');
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!status) return;
    setArchiving(false);
    setName(status.name);
    setColor(status.color);
    setKind(status.kind);
    setDeleting(false);
    setMoveTo('');
  }, [status]);

  const siblings = status ? statusesOf(data, status.projectId) : [];
  const index = status ? siblings.findIndex((s) => s.id === status.id) : -1;
  const cards = status ? data.items.filter((i) => i.statusId === status.id).length : 0;
  const onBoard = status ? columnItems(data, status.id).length : 0;
  const others = siblings.filter((s) => s.id !== status?.id);

  const save = () => {
    if (!status || !name.trim()) return;
    const fields: Partial<Pick<PlanStatus, 'name' | 'color' | 'kind'>> = {};
    if (name.trim() !== status.name) fields.name = name.trim();
    if (color !== status.color) fields.color = color;
    if (kind !== status.kind) fields.kind = kind;
    if (Object.keys(fields).length) store.updateStatus(status.id, fields);
    onClose();
  };
  const shift = (delta: number) => {
    if (!status) return;
    const ids = siblings.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    store.reorderStatuses(status.projectId, ids);
    onClose();
  };

  return (
    <>
      <Modal
        open={Boolean(status) && !deleting && !archiving}
        title={t('planning.statusSettings')}
        onClose={onClose}
        footer={
          <>
            {siblings.length > 1 && (
              <Button variant="danger" className="plan-sheet-aside" onClick={() => setDeleting(true)}>
                {t('planning.deleteStatus')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={save} disabled={!name.trim()}>
              {t('common.save')}
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
          <Field label={t('planning.fieldName')} className="span-2">
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('planning.fieldColor')} className="span-2">
            <ColorPicker value={color} onChange={setColor} label={t('planning.fieldColor')} />
          </Field>
          <Field label={t('planning.fieldKind')} hint={t(`planning.kindHint_${kind}`)} className="span-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value as PlanKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`planning.kind_${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          {status?.kind === 'done' && onBoard > 0 && (
            <div className="span-2 plan-sheet-row">
              <Button size="sm" onClick={() => setArchiving(true)}>
                {t('planning.archiveAllDone')}
              </Button>
            </div>
          )}
          <div className="span-2 plan-sheet-row">
            <Button size="sm" disabled={index <= 0} onClick={() => shift(-1)}>
              {t('planning.moveLeft')}
            </Button>
            <Button size="sm" disabled={index < 0 || index >= siblings.length - 1} onClick={() => shift(1)}>
              {t('planning.moveRight')}
            </Button>
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>
      <Modal
        open={Boolean(status) && deleting}
        title={t('planning.deleteStatusTitle', { name: status?.name ?? '' })}
        onClose={() => setDeleting(false)}
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              disabled={cards > 0 && !moveTo}
              onClick={() => {
                if (!status) return;
                store.deleteStatus(status.id, cards > 0 ? moveTo : null);
                onClose();
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        {cards > 0 ? (
          <div className="stack">
            <p>{t('planning.deleteStatusMove', { count: cards })}</p>
            <Field label={t('planning.moveCardsTo')}>
              <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">{t('planning.chooseStatus')}</option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <p>{t('planning.deleteStatusEmpty')}</p>
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(status) && archiving}
        tone="primary"
        title={t('planning.archiveAllTitle', { count: onBoard, name: status?.name ?? '' })}
        body={t('planning.archiveAllBody')}
        confirmLabel={t('common.archive')}
        onConfirm={() => {
          if (status) {
            archiveColumn(store, data, status.id, {
              done: t('planning.archivedAllToast', { count: onBoard }),
              undo: t('planning.undo'),
            });
          }
          setArchiving(false);
          onClose();
        }}
        onClose={() => setArchiving(false)}
      />
    </>
  );
}

/* ---- Card (round 1's simple sheet) ---- */

export function CardQuickSheet({
  item,
  data,
  store,
  onClose,
  onMoveTo,
}: {
  item: PlanItem | null;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
  onMoveTo: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priority, setPriority] = useState<PlanPriority>('none');
  const [dueDate, setDueDate] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const itemId = item?.id;

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setStatusId(item.statusId);
    setPriority(item.priority);
    setDueDate(item.dueDate);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a different card opens
  }, [itemId]);

  const statuses = item ? statusesOf(data, item.projectId) : [];

  const save = () => {
    if (!item || !title.trim()) return;
    const fields: Partial<PlanItem> = {};
    if (title.trim() !== item.title) fields.title = title.trim();
    if (priority !== item.priority) fields.priority = priority;
    if (dueDate !== item.dueDate) fields.dueDate = dueDate;
    if (statusId !== item.statusId) fields.statusId = statusId;
    if (Object.keys(fields).length) store.updateItem(item.id, fields);
    onClose();
  };

  return (
    <>
      <Modal
        open={Boolean(item) && !confirmDelete}
        title={t('planning.editCard')}
        onClose={onClose}
        footer={
          <>
            {item && (
              <Button
                variant="ghost"
                className="plan-sheet-aside"
                onClick={() => {
                  store.archiveItem(item.id, !item.archivedAt);
                  onClose();
                }}
              >
                {item.archivedAt ? t('common.restore') : t('common.archive')}
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('common.delete')}
            </Button>
            <Button variant="primary" onClick={save} disabled={!title.trim()}>
              {t('common.save')}
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
          <Field label={t('planning.fieldTitle')} className="span-2">
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label={t('planning.fieldStatus')}>
            <Select value={statusId} onChange={(e) => setStatusId(e.target.value)}>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('planning.fieldPriority')}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as PlanPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`planning.priority_${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('planning.fieldDue')}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <div className="plan-sheet-row plan-sheet-row--end">
            <Button
              size="sm"
              onClick={() => {
                if (!item) return;
                onClose();
                onMoveTo(item.id);
              }}
            >
              {t('planning.moveTo')}
            </Button>
          </div>
          <button type="submit" hidden />
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(item) && confirmDelete}
        title={t('planning.deleteCardTitle')}
        body={t('planning.deleteCardBody', { title: item?.title ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (item) store.deleteItem(item.id);
          setConfirmDelete(false);
          onClose();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

/* ---- Move to… (status, then top or bottom) ---- */

export function MoveToSheet({
  item,
  data,
  store,
  onClose,
}: {
  item: PlanItem | null;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [statusId, setStatusId] = useState('');
  useEffect(() => {
    if (item) setStatusId(item.statusId);
  }, [item]);
  const statuses = item ? statusesOf(data, item.projectId) : [];
  const size = useMemo(() => (item && statusId ? columnItems(data, statusId).filter((i) => i.id !== item.id).length : 0), [data, item, statusId]);

  const go = (where: 'top' | 'bottom') => {
    if (!item || !statusId) return;
    store.moveItem(item.id, statusId, where === 'top' ? 0 : size);
    onClose();
  };

  return (
    <Modal open={Boolean(item)} title={t('planning.moveToTitle', { title: item?.title ?? '' })} onClose={onClose} width={420}>
      <div className="stack">
        <div className="plan-move-list" role="radiogroup" aria-label={t('planning.fieldStatus')}>
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={statusId === s.id}
              className={`plan-move-option${statusId === s.id ? ' is-active' : ''}`}
              onClick={() => setStatusId(s.id)}
            >
              <span className="plan-dot" style={s.color ? { background: s.color } : undefined} aria-hidden="true" />
              <span>{s.name}</span>
              {s.id === item?.statusId && <span className="plan-quiet">{t('planning.currentStatus')}</span>}
            </button>
          ))}
        </div>
        <div className="plan-sheet-row">
          <Button onClick={() => go('top')}>{t('planning.moveTop')}</Button>
          <Button variant="primary" onClick={() => go('bottom')}>
            {t('planning.moveBottom')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---- 409: changed on another device ---- */

export function ConflictDialog({ conflict, store }: { conflict: PlanningConflict | null; store: PlanningStore }) {
  const { t } = useTranslation();
  const current = conflict?.current as { name?: string; title?: string } | undefined;
  const label = current?.title ?? current?.name ?? '';
  return (
    <Modal
      open={Boolean(conflict)}
      title={t('planning.conflictTitle')}
      /* Closing without a choice keeps the safer one: the server's. */
      onClose={() => store.resolveConflict('latest')}
      width={440}
      footer={
        <>
          <Button onClick={() => store.resolveConflict('latest')}>{t('planning.useLatest')}</Button>
          <Button variant="primary" onClick={() => store.resolveConflict('mine')}>
            {t('planning.keepMine')}
          </Button>
        </>
      }
    >
      <p>{label ? t('planning.conflictBodyNamed', { name: label }) : t('planning.conflictBody')}</p>
    </Modal>
  );
}
