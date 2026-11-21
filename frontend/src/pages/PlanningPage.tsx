import { AlertTriangle, CalendarClock, FolderKanban, Plus, ServerCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { CardDetailSheet } from '../components/planning/CardDetailSheet';
import { PlanningBoard } from '../components/planning/PlanningBoard';
import { BudgetSummary } from '../components/planning/PlanningProjectInfo';
import { ConflictDialog, ProjectSheet } from '../components/planning/PlanningSheets';
import { PlanningSkeleton } from '../components/skeleton/pageSkeletons';
import { Alert, Button, EmptyState, ProgressBar, Segmented } from '../components/ui';
import { cx, formatDate, todayKey } from '../lib/format';
import { dueTag, overdueCount, projectProgress, projectsIn } from '../lib/planning/model';
import { usePlanning } from '../lib/planning/usePlanning';
import { openPlanning, useHashParam } from '../lib/router';
import { registerPlanningStrings } from '../locales/planning';
import { useSettings } from '../state/SettingsContext';
import type { PlanningData, PlanProject } from '../types/planning';
import '../styles/planning.css';

/* Before anything here renders: the page's strings travel with its chunk. */
registerPlanningStrings();

/**
 * #/planning — projects as boards of cards (GitHub Projects-like).
 * #/planning?project=<id> — one project's board.
 *
 * The data is one request (`planProjects.list`) held in the Planning store
 * (lib/planning/store.ts); this page and the board read it from there.
 */
export default function PlanningPage() {
  const { t } = useTranslation();
  const view = usePlanning();
  const projectParam = useHashParam('project');
  const projectId = projectParam ? view.store.resolve(projectParam) : null;

  /* Leaving with writes still queued, in flight or being typed asks first;
     a normal close (everything saved) never does. */
  useEffect(() => {
    const store = view.store;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.hasUnsent()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [view.store]);

  /* A project opened while still being created: swap the address to its real id. */
  useEffect(() => {
    if (projectParam && projectId && projectId !== projectParam) {
      window.location.replace(`#/planning?project=${encodeURIComponent(projectId)}`);
    }
  }, [projectParam, projectId]);

  let body;
  if (view.backendMissing) {
    body = (
      <EmptyState
        icon={<Icon icon={ServerCog} size="xl" />}
        title={t('planning.backendTitle')}
        description={t('planning.backendBody')}
      />
    );
  } else if (!view.data) {
    body = view.error ? (
      <Alert tone="error" title={t('planning.loadFailed')}>
        <p>{view.error}</p>
        <Button variant="secondary" onClick={() => void view.store.load(true)}>
          {t('common.tryAgain')}
        </Button>
      </Alert>
    ) : (
      <PlanningSkeleton board={Boolean(projectId)} head={false} />
    );
  } else if (projectId) {
    const project = view.data.projects.find((p) => p.id === projectId);
    body = project ? (
      <PlanningBoard
        key={project.id}
        data={view.data}
        project={project}
        store={view.store}
        renderCardSheet={(props) => <CardDetailSheet {...props} />}
      />
    ) : (
      <EmptyState
        icon={<Icon icon={FolderKanban} size="xl" />}
        title={t('planning.projectGone')}
        action={<Button onClick={() => openPlanning(null)}>{t('planning.backToList')}</Button>}
      />
    );
  } else {
    body = <ProjectList data={view.data} store={view.store} />;
  }

  return (
    <div className="plan">
      {!projectId && (
        <header className="page-head plan-head">
          <div>
            <h1 className="page-title">{t('nav.planning')}</h1>
            <p className="page-subtitle">{t('planning.subtitle')}</p>
          </div>
        </header>
      )}
      {body}
      <ConflictDialog conflict={view.conflict} store={view.store} />
    </div>
  );
}

/* ---- The list ---- */

function ProjectList({ data, store }: { data: PlanningData; store: ReturnType<typeof usePlanning>['store'] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<PlanProject['state']>('active');
  const [editing, setEditing] = useState<PlanProject | 'new' | null>(null);
  const projects = useMemo(() => projectsIn(data, filter), [data, filter]);
  const archivedCount = useMemo(() => projectsIn(data, 'archived').length, [data]);
  const today = todayKey();

  const empty = !projects.length;
  return (
    <>
      <div className="plan-toolbar">
        {(archivedCount > 0 || filter === 'archived') && (
          <Segmented<PlanProject['state']>
            value={filter}
            onChange={setFilter}
            ariaLabel={t('planning.filterLabel')}
            options={[
              { value: 'active', label: t('planning.filterActive') },
              { value: 'archived', label: t('planning.filterArchived') },
            ]}
          />
        )}
        <Button className="plan-new" onClick={() => setEditing('new')}>
          <Icon icon={Plus} size="sm" />
          {t('planning.newProject')}
        </Button>
      </div>

      {empty && filter === 'active' && (
        <EmptyState
          icon={<Icon icon={FolderKanban} size="xl" />}
          title={t('planning.emptyTitle')}
          description={t('planning.emptyBody')}
          action={<Button onClick={() => setEditing('new')}>{t('planning.emptyAction')}</Button>}
        />
      )}
      {empty && filter === 'archived' && <p className="plan-quiet">{t('planning.archivedEmpty')}</p>}

      {!empty && (
        <ul className="plan-grid">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectTile data={data} project={project} today={today} />
            </li>
          ))}
        </ul>
      )}

      <ProjectSheet
        open={editing !== null}
        project={editing === 'new' ? null : editing}
        data={data}
        store={store}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ProjectTile({ data, project, today }: { data: PlanningData; project: PlanProject; today: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const progress = projectProgress(data, project.id);
  const overdue = overdueCount(data, project.id, today);
  const tag = dueTag(project.dueDate, today, progress.total > 0 && progress.done === progress.total);

  return (
    <button type="button" className="plan-tile" onClick={() => openPlanning(project.id)}>
      <span className="plan-tile-head">
        <ProjectMark project={project} />
        <span className="plan-tile-name">{project.name}</span>
      </span>
      <span className="plan-tile-progress">
        {progress.percent === null ? (
          <span className="plan-quiet">{t('planning.noCards')}</span>
        ) : (
          <>
            <span className="plan-tile-pct">{t('planning.percentDone', { percent: progress.percent })}</span>
            <span className="plan-quiet">{t('planning.cardsDone', { done: progress.done, total: progress.total })}</span>
          </>
        )}
      </span>
      <ProgressBar percent={progress.percent ?? 0} label={t('planning.percentDone', { percent: progress.percent ?? 0 })} />
      <span className="plan-tile-tags">
        {overdue > 0 && (
          <span className="plan-tag plan-tag--overdue">
            <Icon icon={AlertTriangle} size="sm" />
            {t('planning.overdueCards', { count: overdue })}
          </span>
        )}
        {project.dueDate && (
          <span className={cx('plan-tag', tag && `plan-tag--${tag}`)}>
            <Icon icon={CalendarClock} size="sm" />
            {t('planning.dueOn', { date: formatDate(project.dueDate, settings.locale) })}
          </span>
        )}
      </span>
      <BudgetSummary data={data} projectId={project.id} className="plan-money--tile" />
    </button>
  );
}

/** The project's icon on a wash of its colour (text colour on top, so it reads in every theme). */
export function ProjectMark({ project, size = 'md' }: { project: Pick<PlanProject, 'icon' | 'color'>; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cx('plan-mark', size === 'lg' && 'plan-mark--lg')}
      style={project.color ? ({ '--plan-color': project.color } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      {project.icon || <Icon icon={FolderKanban} size="sm" />}
    </span>
  );
}
