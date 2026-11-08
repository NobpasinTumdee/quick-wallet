import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type Favourite, type FavouriteSort, type FavouriteStyle, MAX_FAVOURITES } from '../../lib/favourites';
import { cx } from '../../lib/format';
import type { TranslationKey } from '../../locales/en';
import { useFavourites } from './FavouritesHost';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { Button, Modal, Segmented } from '../ui';
import { FavouriteBadge } from './FavouriteBadge';

const STYLE_LABEL: Record<FavouriteStyle, TranslationKey> = {
  auto: 'favourites.styleAuto',
  chips: 'favourites.styleChips',
  tiles: 'favourites.styleTiles',
  list: 'favourites.styleList',
};

/**
 * Order, display and the list itself. Every change applies at once (and
 * syncs), like the editors of the card layouts' phone order. Drag a row by
 * its handle, or use ↑ / ↓ (44px targets; focus stays on the pressed button).
 */
export function ManageFavourites({ onClose }: { onClose: () => void }) {
  const fav = useFavourites({ sync: true });
  /* Rendered by the host, so the host is up. */
  return fav ? <ManageBody fav={fav} onClose={onClose} /> : null;
}

function ManageBody({ fav, onClose }: { fav: NonNullable<ReturnType<typeof useFavourites>>; onClose: () => void }) {
  const { t } = useTranslation();
  const { list } = fav;
  const [announcement, setAnnouncement] = useState('');
  const [deleting, setDeleting] = useState<Favourite | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  /* Keep focus on the pressed arrow after the row moves (the other one at the ends). */
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const pick = (dir: string) => listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${dir}"][data-fav="${want.id}"]`);
    const own = pick(want.dir);
    (own && !own.disabled ? own : pick(want.dir === 'up' ? 'down' : 'up'))?.focus();
  }, [list]);

  const total = list.favs.length;
  const move = (item: Favourite, dir: 'up' | 'down') => {
    const index = list.favs.findIndex((f) => f.id === item.id);
    const to = index + (dir === 'up' ? -1 : 1);
    if (to < 0 || to >= total) return;
    pendingFocus.current = { id: item.id, dir };
    fav.move(item.id, dir === 'up' ? -1 : 1);
    setAnnouncement(t('favourites.announceMoved', { name: item.name, position: to + 1, n: total }));
  };

  /* ---- Drag by the handle (pointer events: mouse, touch and pen alike) ---- */
  const [dragging, setDragging] = useState<{ id: string; over: number } | null>(null);
  const onHandleDown = (event: ReactPointerEvent<HTMLButtonElement>, item: Favourite) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* fine without capture */
    }
    setDragging({ id: item.id, over: list.favs.findIndex((f) => f.id === item.id) });
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>(':scope > li')];
    let over = rows.length - 1;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i].getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) {
        over = i;
        break;
      }
    }
    if (over !== dragging.over) setDragging({ ...dragging, over });
  };
  const onHandleUp = () => {
    if (!dragging) return;
    const item = list.favs.find((f) => f.id === dragging.id);
    const from = list.favs.findIndex((f) => f.id === dragging.id);
    setDragging(null);
    if (!item || from === dragging.over) return;
    fav.place(item.id, dragging.over);
    setAnnouncement(t('favourites.announceMoved', { name: item.name, position: dragging.over + 1, n: total }));
  };

  return (
    <>
      <Modal
        open
        title={t('favourites.manageTitle')}
        onClose={onClose}
        footer={
          <>
            <Button onClick={() => fav.openEditor()} disabled={total >= MAX_FAVOURITES}>
              <Icon icon={Plus} size="sm" />
              {t('favourites.add')}
            </Button>
            <Button variant="primary" onClick={onClose}>
              {t('layout.done')}
            </Button>
          </>
        }
      >
        <div className="stack fav-manage">
          <div className="fav-manage-options">
            <span className="field-label">{t('favourites.style')}</span>
            <Segmented<FavouriteStyle>
              value={list.style}
              ariaLabel={t('favourites.style')}
              onChange={fav.setStyle}
              options={(['auto', 'chips', 'tiles', 'list'] as const).map((value) => ({ value, label: t(STYLE_LABEL[value]) }))}
            />
            <span className="field-label">{t('favourites.sort')}</span>
            <Segmented<FavouriteSort>
              value={list.sort}
              ariaLabel={t('favourites.sort')}
              onChange={fav.setSort}
              options={[
                { value: 'manual', label: t('favourites.sortManual') },
                { value: 'usage', label: t('favourites.sortUsage') },
              ]}
            />
            {list.sort === 'usage' && <p className="arrange-hint">{t('favourites.sortUsageHint')}</p>}
          </div>

          <p className="arrange-hint">
            {t('favourites.count', { count: total, max: MAX_FAVOURITES })}
          </p>

          {total === 0 ? (
            <p className="arrange-hint">{t('favourites.emptyBody')}</p>
          ) : (
            <ol ref={listRef} className="arrange-list fav-manage-list">
              {list.favs.map((item, index) => (
                <li
                  key={item.id}
                  className={cx(
                    'arrange-row fav-manage-row',
                    dragging?.id === item.id && 'is-dragging',
                    dragging && dragging.id !== item.id && dragging.over === index && 'is-drop-target',
                  )}
                >
                  <button
                    type="button"
                    className="fav-manage-handle"
                    aria-label={t('favourites.dragHandle', { name: item.name })}
                    title={t('favourites.dragHint')}
                    onPointerDown={(event) => onHandleDown(event, item)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={() => setDragging(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        move(item, event.key === 'ArrowUp' ? 'up' : 'down');
                      }
                    }}
                  >
                    <Icon icon={GripVertical} size="sm" />
                  </button>
                  <FavouriteBadge fav={item} />
                  <span className="arrange-name">
                    <span className="truncate">{item.name}</span>
                    <small>
                      {item.group ? `${item.group} · ` : ''}
                      {item.uses > 0 ? t('favourites.uses', { count: item.uses }) : t('favourites.notUsed')}
                    </small>
                  </span>
                  <span className="arrange-actions">
                    <button
                      type="button"
                      className="arrange-move"
                      data-move="up"
                      data-fav={item.id}
                      disabled={index === 0}
                      aria-label={t('favourites.moveUp', { name: item.name })}
                      onClick={() => move(item, 'up')}
                    >
                      <Icon icon={ArrowUp} size="sm" />
                    </button>
                    <button
                      type="button"
                      className="arrange-move"
                      data-move="down"
                      data-fav={item.id}
                      disabled={index === total - 1}
                      aria-label={t('favourites.moveDown', { name: item.name })}
                      onClick={() => move(item, 'down')}
                    >
                      <Icon icon={ArrowDown} size="sm" />
                    </button>
                    <button
                      type="button"
                      className="arrange-move"
                      aria-label={t('favourites.editNamed', { name: item.name })}
                      onClick={() => fav.openEditor(item)}
                    >
                      <Icon icon={Pencil} size="sm" />
                    </button>
                    <button
                      type="button"
                      className="arrange-move"
                      aria-label={t('favourites.deleteNamed', { name: item.name })}
                      onClick={() => setDeleting(item)}
                    >
                      <Icon icon={Trash2} size="sm" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {announcement}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t('favourites.deleteTitle', { name: deleting?.name ?? '' })}
        body={t('favourites.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleting) {
            fav.remove(deleting.id);
            setAnnouncement(t('favourites.announceDeleted', { name: deleting.name }));
          }
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
