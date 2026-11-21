import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDate } from '../../lib/format';
import { columnItems, statusesOf } from '../../lib/planning/model';
import type { PlanningStore } from '../../lib/planning/store';
import { toast } from '../../lib/toast';
import { useSettings } from '../../state/SettingsContext';
import type { PlanItem, PlanningData, PlanProject } from '../../types/planning';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Button, Modal } from '../ui';

/**
 * Unarchives a card: back to its status (the first one if that status is
 * gone), at the bottom of the column. The server keeps an archived card's
 * rank, so when other cards have gone below it since, a move follows.
 */
export function unarchiveToEnd(store: PlanningStore, data: PlanningData, item: PlanItem): void {
  const statuses = statusesOf(data, item.projectId);
  const statusId = statuses.some((s) => s.id === item.statusId) ? item.statusId : statuses[0]?.id;
  store.archiveItem(item.id, false);
  if (!statusId) return;
  if (statusId !== item.statusId) {
    store.updateItem(item.id, { statusId });
    return;
  }
  const column = columnItems(data, statusId);
  if (column.length && column.some((c) => c.rank > item.rank)) store.moveItem(item.id, statusId, column.length);
}

/** Archives every card in a column, with one Undo toast for all of them. */
export function archiveColumn(store: PlanningStore, data: PlanningData, statusId: string, labels: { done: string; undo: string }): number {
  const cards = columnItems(data, statusId);
  if (!cards.length) return 0;
  cards.forEach((card) => store.archiveItem(card.id, true));
  toast.success(labels.done, undefined, {
    duration: 8000,
    /* Unarchiving keeps each card's rank, so they come back in their order. */
    action: { label: labels.undo, onClick: () => cards.forEach((card) => store.archiveItem(card.id, false)) },
  });
  return cards.length;
}

export function ArchivedSheet({
  open,
  data,
  project,
  store,
  loaded,
  onOpenCard,
  onClose,
}: {
  open: boolean;
  data: PlanningData;
  project: PlanProject;
  store: PlanningStore;
  loaded: boolean;
  onOpenCard: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [deleting, setDeleting] = useState<PlanItem | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    store.loadArchived().then(
      () => {
        if (store.getState().error) setFailed(true);
      },
      () => setFailed(true),
    );
  }, [open, store]);

  const cards = useMemo(
    () =>
      data.items
        .filter((i) => i.projectId === project.id && i.archivedAt)
        .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
    [data.items, project.id],
  );
  const statusName = (id: string) => data.statuses.find((s) => s.id === id)?.name ?? '';

  return (
    <>
      <Modal open={open} title={t('planning.archivedTitle', { name: project.name })} onClose={onClose} width={560} className="plan-picker">
        {!loaded && !failed ? (
          <ul className="plan-tx-list" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="plan-tx-sk" />
            ))}
          </ul>
        ) : failed && !loaded ? (
          <div className="stack">
            <p>{t('planning.archivedFailed')}</p>
            <Button onClick={() => void store.loadArchived()}>{t('common.tryAgain')}</Button>
          </div>
        ) : cards.length ? (
          <ul className="plan-tx-list">
            {cards.map((card) => (
              <li key={card.id} className="plan-tx-item">
                <button
                  type="button"
                  className="plan-tx"
                  onClick={() => {
                    onClose();
                    onOpenCard(card.id);
                  }}
                >
                  <span className="plan-tx-body">
                    <span className="plan-tx-title">{card.title}</span>
                    <span className="plan-tx-meta">
                      {statusName(card.statusId)}
                      {' · '}
                      {t('planning.archivedOn', { date: formatDate(card.archivedAt.slice(0, 10), settings.locale) })}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="plan-icon-btn"
                  aria-label={t('planning.unarchiveNamed', { title: card.title })}
                  title={t('planning.unarchive')}
                  onClick={() => unarchiveToEnd(store, data, card)}
                >
                  <Icon icon={ArchiveRestore} size="sm" />
                </button>
                <button
                  type="button"
                  className="plan-icon-btn plan-icon-btn--danger"
                  aria-label={t('planning.deleteNamed', { title: card.title })}
                  title={t('common.delete')}
                  onClick={() => setDeleting(card)}
                >
                  <Icon icon={Trash2} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plan-quiet plan-picker-empty">{t('planning.noArchivedCards')}</p>
        )}
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title={t('planning.deleteCardTitle')}
        body={t('planning.deleteArchivedBody', { title: deleting?.title ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleting) store.deleteItem(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
