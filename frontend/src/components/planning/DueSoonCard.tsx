import { AlertTriangle, ArrowRight, CalendarCheck, ServerCog } from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cx, formatDate, todayKey } from '../../lib/format';
import { dueSoonItems, type DueSoonRow } from '../../lib/planning/dueSoon';
import { usePlanningCached } from '../../lib/planning/usePlanning';
import { registerPlanningStrings } from '../../locales/planning';
import { useSettings } from '../../state/SettingsContext';
import { FitList } from '../FitList';
import { Icon } from '../Icon';
import { Button, Card, EmptyState } from '../ui';

/* Before anything here renders: Planning's strings travel with this chunk. */
registerPlanningStrings();

/** Rows a phone (or an unplaced card) shows before "+N more". */
const PHONE_ROWS = 5;

function openCard(row: DueSoonRow) {
  window.location.hash = `#/planning?project=${encodeURIComponent(row.project.id)}&card=${encodeURIComponent(row.item.id)}`;
}

/**
 * Home's "Due soon" card: Planning cards not done, overdue or due within
 * seven days of today (the user's local date). Its own chunk with the
 * Planning store, so Home without this card never loads either, and never
 * asks the server for Planning (see usePlanningCached for how often it does).
 */
export function DueSoonCard({ sizeClass, fill, fallback }: { sizeClass: string; fill: boolean; fallback: ReactNode }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const view = usePlanningCached();
  const today = todayKey();
  const rows = useMemo(() => (view.data ? dueSoonItems(view.data, today) : []), [view.data, today]);

  const open = (
    <Button size="sm" variant="ghost" onClick={() => (window.location.hash = '#/planning')}>
      {t('planning.dueSoonOpen')}
      <Icon icon={ArrowRight} size="sm" />
    </Button>
  );
  const shell = (body: ReactNode) => (
    <Card className={cx('due-card', sizeClass)} title={t('planDueSoon.title')} actions={view.backendMissing ? undefined : open} padded={false}>
      {body}
    </Card>
  );

  if (view.backendMissing) {
    return shell(
      <EmptyState icon={<Icon icon={ServerCog} size="xl" />} title={t('planning.dueSoonUnavailable')} description={t('planning.dueSoonUnavailableBody')} />,
    );
  }
  if (!view.data) {
    if (!view.error) return <>{fallback}</>;
    return shell(
      <div className="due-empty">
        <p>{t('planning.dueSoonLoadFailed')}</p>
        <Button size="sm" variant="secondary" onClick={() => void view.store.load(true)}>
          {t('common.tryAgain')}
        </Button>
      </div>,
    );
  }
  if (!rows.length) {
    return shell(<EmptyState icon={<Icon icon={CalendarCheck} size="xl" />} title={t('planning.dueSoonEmpty')} description={t('planning.dueSoonEmptyBody')} />);
  }

  const dueText = (row: DueSoonRow) =>
    row.days === 0 ? t('planning.dueToday') : row.days === 1 ? t('planning.dueTomorrow') : formatDate(row.item.dueDate, settings.locale);

  const moreLink = (n: number) => (
    <Button size="sm" variant="ghost" className="fit-more-link" aria-label={t('planning.dueSoonMore', { n })} onClick={() => (window.location.hash = '#/planning')}>
      {t('layout.moreCount', { n })}
    </Button>
  );

  return shell(
    <div className="due-body">
      <FitList
        items={rows}
        fallback={PHONE_ROWS}
        active={fill}
        className="due-list"
        more={moreLink}
        renderItem={(row) => {
          const overdue = row.days < 0;
          const soon = !overdue && row.days <= 3;
          const date = formatDate(row.item.dueDate, settings.locale);
          return (
            <div key={row.item.id} className="due-row">
              <button
                type="button"
                className="due-row-btn"
                aria-label={t('planning.dueSoonRow', {
                  title: row.item.title,
                  project: row.project.name,
                  due: overdue ? t('planning.dueOverdueOn', { date }) : t('planning.dueOnDate', { date: dueText(row) }),
                })}
                onClick={() => openCard(row)}
              >
                <span className="due-row-main">
                  <span className="due-row-title">{row.item.title}</span>
                  <span className="due-row-project">
                    <span
                      className="due-dot"
                      style={row.project.color ? ({ '--due-color': row.project.color } as CSSProperties) : undefined}
                      aria-hidden="true"
                    />
                    <span className="due-row-project-name">{row.project.name}</span>
                  </span>
                </span>
                <span className={cx('due-row-tag', overdue && 'due-row-tag--overdue', soon && 'due-row-tag--soon')}>
                  {overdue && <Icon icon={AlertTriangle} size="sm" />}
                  {dueText(row)}
                </span>
              </button>
            </div>
          );
        }}
      />
      {/* Not filling a grid cell (phones): FitList shows the first rows only, so say how many more. */}
      {!fill && rows.length > PHONE_ROWS && <div className="fit-more">{moreLink(rows.length - PHONE_ROWS)}</div>}
    </div>,
  );
}
