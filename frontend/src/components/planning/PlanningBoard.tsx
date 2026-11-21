import { ArrowLeft, CheckSquare, GripVertical, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx, formatCompactAmount, formatDate, todayKey } from '../../lib/format';
import { useMotion } from '../../lib/motion';
import { EMPTY_FILTERS, filterContext, isFiltering, matchesFilters, type PlanFilters, projectLabels } from '../../lib/planning/filters';
import { boardItems, checklistProgress, columnItems, dueTag, projectProgress, statusesOf } from '../../lib/planning/model';
import type { PlanningStore } from '../../lib/planning/store';
import { hashParam, openPlanning } from '../../lib/router';
import { whenHistorySettled } from '../../lib/overlayStack';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { PlanItem, PlanningData, PlanProject, PlanStatus } from '../../types/planning';
import { Icon } from '../Icon';
import { Button, Portal } from '../ui';
import { ArchivedSheet } from './PlanningArchived';
import { PlanningToolbar, type PlanView } from './PlanningFilters';
import { CardQuickSheet, MoveToSheet, ProjectSheet, StatusSheet } from './PlanningSheets';
import { PlanningMilestones } from './PlanningMilestones';
import { BudgetSummary, ProjectGoalChip } from './PlanningProjectInfo';
import { PlanningTable } from './PlanningTable';
import { projectBudget } from '../../lib/planning/milestones';
import { type DragAnnouncement, previewOf, useBoardDrag } from './useBoardDrag';

const MAX_LABELS = 3;

/** Filters last for the session, per project (not saved). */
const sessionFilters = new Map<string, PlanFilters>();

const viewKey = (projectId: string) => `quick-wallet.planning.view.${projectId}`;

/** Board, table or milestones, remembered per project on this device. */
function readView(projectId: string): PlanView {
  try {
    const stored = window.localStorage.getItem(viewKey(projectId));
    return stored === 'table' || stored === 'milestones' ? stored : 'board';
  } catch {
    return 'board';
  }
}

function writeView(projectId: string, view: PlanView): void {
  try {
    window.localStorage.setItem(viewKey(projectId), view);
  } catch {
    /* Private mode: the board stays the default. */
  }
}

export interface CardSheetProps {
  item: PlanItem | null;
  data: PlanningData;
  store: PlanningStore;
  onClose: () => void;
  onMoveTo: (id: string) => void;
}

/**
 * One project's board. The card sheet is a prop so round 2's full detail
 * sheet replaces it without touching anything here.
 */
export function PlanningBoard({
  data,
  project,
  store,
  renderCardSheet = (props) => <CardQuickSheet {...props} />,
}: {
  data: PlanningData;
  project: PlanProject;
  store: PlanningStore;
  renderCardSheet?: (props: CardSheetProps) => ReactNode;
}) {
  const { t } = useTranslation();
  const motion = useMotion();
  const boardRef = useRef<HTMLDivElement | null>(null);
  /* The open card is in the address (replaced, not pushed: Back already
     closes the sheet through the overlay stack), so a reload reopens it. */
  const [openId, setOpenIdState] = useState<string | null>(() => hashParam('card'));
  const openIdRef = useRef(openId);
  const setOpenId = useCallback(
    (id: string | null) => {
      openIdRef.current = id;
      setOpenIdState(id);
      const base = `#/planning?project=${encodeURIComponent(project.id)}`;
      const apply = () => {
        /* Another card may have opened before a close got here. */
        if (openIdRef.current !== id) return;
        const url = id ? `${base}&card=${encodeURIComponent(id)}` : base;
        if (window.location.hash !== url) window.history.replaceState(window.history.state, '', url);
      };
      if (id) apply();
      /* Closing pops the sheet's history entry a tick later: clean the entry that stays. */
      else window.setTimeout(() => whenHistorySettled(apply), 0);
    },
    [project.id],
  );
  const [filters, setFiltersState] = useState<PlanFilters>(() => sessionFilters.get(project.id) ?? EMPTY_FILTERS);
  const setFilters = (next: PlanFilters) => {
    sessionFilters.set(project.id, next);
    setFiltersState(next);
  };
  const [view, setViewState] = useState<PlanView>(() => readView(project.id));
  /* Where a milestone's cards are shown: the last board or table view. */
  const cardsViewRef = useRef<PlanView>(view === 'table' ? 'table' : 'board');
  const setView = (next: PlanView) => {
    if (next !== 'milestones') cardsViewRef.current = next;
    writeView(project.id, next);
    setViewState(next);
  };
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archivedLoaded = store.getState().archivedLoaded;

  const filtering = isFiltering(filters);
  const today = todayKey();
  const ctx = useMemo(() => filterContext(data, today), [data, today]);
  const isVisible = useMemo(
    () => (filtering ? (item: PlanItem) => matchesFilters(item, filters, ctx) : undefined),
    [filtering, filters, ctx],
  );
  const allCards = useMemo(() => boardItems(data, project.id), [data, project.id]);
  const matchedCards = useMemo(() => (isVisible ? allCards.filter(isVisible) : allCards), [allCards, isVisible]);
  const labels = useMemo(() => projectLabels(data, project.id), [data, project.id]);
  const milestones = useMemo(
    () => data.milestones.filter((m) => m.projectId === project.id).sort((a, b) => a.order - b.order),
    [data.milestones, project.id],
  );
  const archivedCount = archivedLoaded ? data.items.filter((i) => i.projectId === project.id && i.archivedAt).length : null;
  const [moveId, setMoveId] = useState<string | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [addingStatus, setAddingStatus] = useState(false);
  const [live, setLive] = useState('');

  const nameOfStatus = useCallback((id: string) => data.statuses.find((s) => s.id === id)?.name ?? '', [data.statuses]);
  const titleOf = useCallback((id: string) => data.items.find((i) => i.id === id)?.title ?? '', [data.items]);

  const announce = useCallback(
    (e: DragAnnouncement) => {
      switch (e.type) {
        case 'pickedCard':
        case 'movedCard':
        case 'droppedCard':
          setLive(
            t(`planning.live_${e.type}`, { title: titleOf(e.id), status: nameOfStatus(e.spot.statusId), position: e.spot.index + 1 }),
          );
          break;
        case 'pickedColumn':
        case 'movedColumn':
        case 'droppedColumn':
          setLive(t(`planning.live_${e.type}`, { name: nameOfStatus(e.id), position: e.index + 1, total: e.total }));
          break;
        case 'cancelledCard':
          setLive(t('planning.live_cancelled', { name: titleOf(e.id) }));
          break;
        case 'cancelledColumn':
          setLive(t('planning.live_cancelled', { name: nameOfStatus(e.id) }));
          break;
      }
    },
    [nameOfStatus, t, titleOf],
  );

  const drag = useBoardDrag({
    boardRef,
    data,
    projectId: project.id,
    onDropCard: (id, spot) => store.moveItem(id, spot.statusId, spot.index),
    onDropColumn: (ids) => store.reorderStatuses(project.id, ids),
    announce,
    isVisible,
  });

  const shown = useMemo(() => previewOf(data, project.id, drag.session), [data, project.id, drag.session]);
  const statuses = statusesOf(shown, project.id);
  const progress = projectProgress(data, project.id);

  /* The desktop board fills what is left of the window and scrolls inside
     itself; on a phone the page scrolls and the columns snap sideways. */
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;
    const fit = () => {
      if (window.matchMedia('(max-width: 639px)').matches) {
        board.style.height = '';
        return;
      }
      const top = board.getBoundingClientRect().top + window.scrollY;
      board.style.height = `${Math.max(320, window.innerHeight - top - 16)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [view, filtering]);

  const session = drag.session;
  const dragged = session ? (session.kind === 'card' ? shown.items.find((i) => i.id === session.id) : null) : null;
  const draggedColumn = session?.kind === 'column' ? statuses.find((s) => s.id === session.id) : null;

  return (
    <section className={cx('plan-board-page', session && 'is-dragging', `plan-motion-${motion}`)}>
      <header className="plan-board-head">
        <Button variant="ghost" size="sm" className="plan-back" onClick={() => openPlanning(null)} aria-label={t('planning.backToList')}>
          <Icon icon={ArrowLeft} size="sm" />
          <span className="plan-back-label">{t('nav.planning')}</span>
        </Button>
        <h1 className="plan-board-title">
          <span className="plan-mark" style={project.color ? ({ '--plan-color': project.color } as CSSProperties) : undefined} aria-hidden="true">
            {project.icon}
          </span>
          <span className="plan-board-name">{project.name}</span>
        </h1>
        <span className="plan-board-pct">
          {progress.percent === null ? t('planning.noCards') : t('planning.percentDone', { percent: progress.percent })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setEditingProject(true)} aria-label={t('planning.editProject')}>
          <Icon icon={Pencil} size="sm" />
        </Button>
      </header>
      {(project.linkedGoalId || projectBudget(data, project.id).has) && (
        <div className="plan-board-info">
          <ProjectGoalChip project={project} />
          <BudgetSummary data={data} projectId={project.id} />
        </div>
      )}
      <p className="sr-only" id="plan-drag-help">
        {t('planning.dragHelp')}
      </p>
      <div className="sr-only" aria-live="assertive" role="status">
        {live}
      </div>

      <PlanningToolbar
        filters={filters}
        onChange={setFilters}
        labels={labels}
        milestones={milestones}
        view={view}
        onView={(next) => {
          if (session) drag.cancel();
          setView(next);
        }}
        archivedCount={archivedCount}
        onArchived={() => setArchivedOpen(true)}
        matched={matchedCards.length}
        total={allCards.length}
      />

      {view === 'milestones' ? (
        <PlanningMilestones
          data={data}
          project={project}
          store={store}
          onShowCards={(milestoneId) => {
            setFilters({ ...filters, milestones: [milestoneId] });
            setView(cardsViewRef.current);
          }}
        />
      ) : view === 'table' ? (
        <PlanningTable data={data} project={project} items={matchedCards} total={allCards.length} onOpen={setOpenId} />
      ) : (
      <div className="plan-board" ref={boardRef} role="list" aria-label={t('planning.boardLabel', { name: project.name })}>
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            data={shown}
            store={store}
            project={project}
            placeholderColumn={session?.kind === 'column' && session.pointer && session.id === status.id}
            placeholderCard={session?.kind === 'card' ? session.id : null}
            keyboardCard={session?.kind === 'card' && !session.pointer ? session.id : null}
            keyboardColumn={session?.kind === 'column' && !session.pointer ? session.id : null}
            drag={drag}
            isVisible={isVisible}
            onOpen={setOpenId}
            onMenu={() => setStatusId(status.id)}
          />
        ))}
        <div className="plan-col plan-col--add" role="listitem">
          {addingStatus ? (
            <QuickInput
              placeholder={t('planning.statusName')}
              label={t('planning.addStatus')}
              onSubmit={(name) => store.createStatus(project.id, { name })}
              onClose={() => setAddingStatus(false)}
              keepOpen={false}
            />
          ) : (
            <button type="button" className="plan-add-status" onClick={() => setAddingStatus(true)}>
              <Icon icon={Plus} size="sm" />
              {t('planning.addStatus')}
            </button>
          )}
        </div>
      </div>
      )}

      {session?.pointer && drag.float && (dragged || draggedColumn) && (
        <Portal>
          <div
            ref={drag.floatRef}
            className="plan-float"
            style={{ width: drag.float.width, height: draggedColumn ? undefined : drag.float.height }}
            aria-hidden="true"
          >
            {dragged && <CardFace item={dragged} data={shown} />}
            {draggedColumn && <ColumnHeadFace status={draggedColumn} count={columnItems(shown, draggedColumn.id).length} />}
          </div>
        </Portal>
      )}

      {renderCardSheet({
        item: openId ? data.items.find((i) => i.id === store.resolve(openId) || i.id === openId) ?? null : null,
        data,
        store,
        onClose: () => setOpenId(null),
        onMoveTo: setMoveId,
      })}
      <MoveToSheet
        item={moveId ? data.items.find((i) => i.id === moveId || i.id === store.resolve(moveId)) ?? null : null}
        data={data}
        store={store}
        onClose={() => setMoveId(null)}
      />
      <StatusSheet status={statusId ? data.statuses.find((s) => s.id === statusId || s.id === store.resolve(statusId)) ?? null : null} data={data} store={store} onClose={() => setStatusId(null)} />
      <ProjectSheet open={editingProject} project={project} data={data} store={store} onClose={() => setEditingProject(false)} />
      <ArchivedSheet
        open={archivedOpen}
        data={data}
        project={project}
        store={store}
        loaded={archivedLoaded}
        onOpenCard={setOpenId}
        onClose={() => setArchivedOpen(false)}
      />
    </section>
  );
}

/* ---- A column ---- */

type Drag = ReturnType<typeof useBoardDrag>;

function BoardColumn({
  status,
  data,
  store,
  project,
  placeholderColumn,
  placeholderCard,
  keyboardCard,
  keyboardColumn,
  drag,
  isVisible,
  onOpen,
  onMenu,
}: {
  status: PlanStatus;
  data: PlanningData;
  store: PlanningStore;
  project: PlanProject;
  placeholderColumn: boolean;
  placeholderCard: string | null;
  keyboardCard: string | null;
  keyboardColumn: string | null;
  drag: Drag;
  isVisible?: (item: PlanItem) => boolean;
  onOpen: (id: string) => void;
  onMenu: () => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const all = columnItems(data, status.id);
  /* The card being moved stays on screen even where the filters would hide it. */
  const items = isVisible ? all.filter((i) => isVisible(i) || i.id === placeholderCard) : all;
  const shownCount = isVisible ? all.filter(isVisible).length : all.length;

  return (
    <div
      className={cx('plan-col', placeholderColumn && 'is-placeholder', keyboardColumn === status.id && 'is-lifted')}
      data-col-id={status.id}
      role="listitem"
      aria-label={
        isVisible
          ? t('planning.columnLabelFiltered', { name: status.name, shown: shownCount, count: all.length })
          : t('planning.columnLabel', { name: status.name, count: all.length })
      }
    >
      <div className="plan-col-head" onPointerDown={(e) => drag.onPointerDown(e, { kind: 'column', id: status.id })} onContextMenu={(e) => e.preventDefault()}>
        <button
          type="button"
          className="plan-col-grab"
          data-col-grab={status.id}
          aria-label={t('planning.dragColumn', { name: status.name })}
          aria-describedby="plan-drag-help"
          aria-pressed={keyboardColumn === status.id}
          onKeyDown={(e) => drag.onColumnKeyDown(e, status.id)}
          onClick={(e) => e.preventDefault()}
        >
          <Icon icon={GripVertical} size="sm" />
        </button>
        <ColumnHeadFace status={status} count={all.length} shown={isVisible ? shownCount : undefined} />
        <button type="button" className="plan-col-menu" aria-label={t('planning.columnMenu', { name: status.name })} onClick={onMenu}>
          <Icon icon={MoreHorizontal} size="sm" />
        </button>
      </div>
      <div className="plan-col-body" data-col-body="">
        <ul className="plan-cards">
          {items.map((item) => (
            <li key={item.id}>
              <BoardCard
                item={item}
                data={data}
                placeholder={placeholderCard === item.id}
                lifted={keyboardCard === item.id}
                drag={drag}
                onOpen={() => onOpen(item.id)}
              />
            </li>
          ))}
        </ul>
        {!items.length && !adding && (
          <p className="plan-col-empty">{all.length ? t('planning.columnAllHidden') : t('planning.columnEmpty')}</p>
        )}
      </div>
      <div className="plan-col-foot">
        {adding ? (
          <QuickInput
            placeholder={t('planning.cardTitle')}
            label={t('planning.addCardTo', { name: status.name })}
            onSubmit={(title) => store.createItem(project.id, status.id, { title })}
            onClose={() => setAdding(false)}
            keepOpen
          />
        ) : (
          <button type="button" className="plan-add-card" onClick={() => setAdding(true)}>
            <Icon icon={Plus} size="sm" />
            {t('planning.addCard')}
          </button>
        )}
      </div>
    </div>
  );
}

function ColumnHeadFace({ status, count, shown }: { status: PlanStatus; count: number; shown?: number }) {
  const { t } = useTranslation();
  return (
    <span className="plan-col-title">
      <span className="plan-dot" style={status.color ? { background: status.color } : undefined} aria-hidden="true" />
      <span className="plan-col-name">{status.name}</span>
      <span className="plan-col-count">{shown === undefined ? count : t('planning.xOfY', { shown, count })}</span>
    </span>
  );
}

/* ---- A card ---- */

function BoardCard({
  item,
  data,
  placeholder,
  lifted,
  drag,
  onOpen,
}: {
  item: PlanItem;
  data: PlanningData;
  placeholder: boolean;
  lifted: boolean;
  drag: Drag;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cx('plan-card', placeholder && 'is-placeholder', lifted && 'is-lifted')}
      data-item-id={item.id}
      role="button"
      tabIndex={0}
      aria-describedby="plan-drag-help"
      aria-pressed={lifted || undefined}
      aria-label={item.title}
      onPointerDown={(e) => drag.onPointerDown(e, { kind: 'card', id: item.id })}
      onClick={() => {
        if (drag.consumeClick() || drag.session) return;
        onOpen();
      }}
      onKeyDown={(e) => drag.onCardKeyDown(e, item.id, onOpen)}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      title={t('planning.cardHint')}
    >
      <CardFace item={item} data={data} />
    </div>
  );
}

function CardFace({ item, data }: { item: PlanItem; data: PlanningData }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const done = data.statuses.find((s) => s.id === item.statusId)?.kind === 'done';
  const tag = dueTag(item.dueDate, todayKey(), done);
  const checklist = checklistProgress(item);
  const extra = item.labels.length - MAX_LABELS;
  const over = item.budget !== null && item.spent > item.budget;

  return (
    <>
      <span className="plan-card-top">
        {item.priority !== 'none' && (
          <span className={`plan-prio plan-prio--${item.priority}`} title={t(`planning.priority_${item.priority}`)}>
            <span className="sr-only">{t(`planning.priority_${item.priority}`)}</span>
          </span>
        )}
        <span className="plan-card-title">{item.title}</span>
      </span>
      {item.labels.length > 0 && (
        <span className="plan-labels">
          {item.labels.slice(0, MAX_LABELS).map((label) => (
            <span key={label} className="plan-label">
              {label}
            </span>
          ))}
          {extra > 0 && <span className="plan-label plan-label--more">+{extra}</span>}
        </span>
      )}
      {(item.dueDate || checklist || item.budget !== null) && (
        <span className="plan-card-meta">
          {item.dueDate && (
            <span className={cx('plan-tag', tag && `plan-tag--${tag}`)}>{formatDate(item.dueDate, settings.locale)}</span>
          )}
          {checklist && (
            <span className="plan-meta-item">
              <Icon icon={CheckSquare} size="sm" />
              {checklist.done}/{checklist.total}
            </span>
          )}
          {item.budget !== null && (
            <span className={cx('plan-meta-item', over && 'plan-over')}>
              {t('planning.spentOfBudget', {
                spent: formatCompactAmount(money.convert(item.spent), settings.locale),
                budget: formatCompactAmount(money.convert(item.budget), settings.locale),
              })}
            </span>
          )}
        </span>
      )}
    </>
  );
}

/* ---- Quick add: Enter adds, the field stays open ---- */

function QuickInput({
  placeholder,
  label,
  onSubmit,
  onClose,
  keepOpen,
}: {
  placeholder: string;
  label: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
  keepOpen: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
    if (!keepOpen) onClose();
  };
  return (
    <form
      className="plan-quick"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="control"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        maxLength={200}
        autoFocus
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
      />
      <div className="plan-quick-actions">
        <Button type="submit" variant="primary" size="sm" disabled={!value.trim()}>
          {t('common.add')}
        </Button>
        <Button size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={onClose} aria-label={t('common.close')}>
          <Icon icon={X} size="sm" />
        </Button>
      </div>
    </form>
  );
}
