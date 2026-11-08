import { Copy, Ellipsis, MoveVertical, Pencil, Plus, Settings2, SquarePen, Star, Trash2 } from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { type Favourite, autoStyle, groupFavourites, MAX_FAVOURITES } from '../../lib/favourites';
import { cx, formatDate } from '../../lib/format';
import { useOptionalFavourites } from '../../state/FavouritesContext';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import { ConfirmDialog } from '../ConfirmDialog';
import { Icon } from '../Icon';
import { ToolPanel } from '../notes/ToolPanel';
import { Button, Card, EmptyState } from '../ui';
import { FavouriteBadge } from './FavouriteBadge';
import { useFavourites } from './FavouritesHost';

type Api = NonNullable<ReturnType<typeof useFavourites>>;

/** A touch held this long, without moving, opens the favourite's menu. */
export const LONG_PRESS_MS = 500;
/** Movement that turns a press into a scroll (no menu, no tap). */
const MOVE_SLOP_PX = 10;

/**
 * Home's Favourites card: saved transactions, one tap each.
 *
 * Display adapts to the card (or follows the style chosen in Manage): a row
 * of chips when it is short, tiles, or a list with amounts and usage when it
 * is tall. In Customize the card's content is inert (CardLayoutEditor), so a
 * tap there never saves anything.
 */
export function FavouritesCard({ sizeClass, fallback }: { sizeClass: string; fallback: ReactNode }) {
  /* Starts the favourites host (its own chunk) on first show. */
  const launcher = useOptionalFavourites();
  useEffect(() => launcher?.activate(), [launcher]);
  const fav = useFavourites({ sync: true });
  return fav ? <CardBody fav={fav} sizeClass={sizeClass} /> : <>{fallback}</>;
}

function CardBody({ fav, sizeClass }: { fav: Api; sizeClass: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const { list, ordered, busy, wallets } = fav;

  /* ---- Size → display ---- */
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const body = bodyRef.current?.closest('.card')?.querySelector<HTMLElement>('.card-body');
    const card = bodyRef.current?.closest<HTMLElement>('.card');
    if (!body || !card) return undefined;
    const measure = () => {
      /* Only a card whose height is set by the layout (a placed grid) has a
         height to adapt to; elsewhere it grows with its content. */
      const placed = Boolean(card.closest('.is-placed'));
      setSize({ w: Math.round(body.clientWidth), h: placed ? Math.round(body.clientHeight) : 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const style = list.style === 'auto' ? autoStyle(size.w, size.h) : list.style;

  /* ---- Menu: long-press on touch, right-click, ⋯, or the context-menu key ---- */
  const [menu, setMenu] = useState<{ fav: Favourite; anchor: HTMLElement } | null>(null);
  const [deleting, setDeleting] = useState<Favourite | null>(null);
  const press = useRef<{ id: string; x: number; y: number; timer: number } | null>(null);
  const suppressClick = useRef(false);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, item: Favourite) => {
    suppressClick.current = false;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const anchor = event.currentTarget;
    cancelPress();
    press.current = {
      id: item.id,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        suppressClick.current = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* no haptics */
        }
        setMenu({ fav: item, anchor });
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > MOVE_SLOP_PX) cancelPress();
  };
  /* A scroll of the page (or the card) means the finger was scrolling, not pressing. */
  useLayoutEffect(() => {
    const onScroll = () => cancelPress();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  const onClick = (item: Favourite) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    fav.run(item);
  };
  const onContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, item: Favourite) => {
    event.preventDefault();
    /* On touch the long-press timer opens it; the browser's own context menu
       (fired at about the same time) is only suppressed. */
    if (press.current || suppressClick.current) return;
    setMenu({ fav: item, anchor: event.currentTarget });
  };

  const walletName = (id: string) => wallets.find((w) => w.id === id)?.name ?? '';
  const amountText = (item: Favourite) =>
    item.hideAmount ? '' : item.amount === null ? t('favourites.askAmount') : money(item.amount);
  const label = (item: Favourite) => {
    const what = item.type === 'transfer' ? `${walletName(item.walletId)} → ${walletName(item.toWalletId)}` : item.category;
    const amount = item.amount === null ? t('favourites.askAmount') : money(item.amount);
    return t('favourites.tileLabel', { name: item.name, amount, what });
  };

  /** One favourite. A button: Enter / Space save it, like a tap. */
  const tile = (item: Favourite) => {
    const saving = busy.has(item.id);
    const sub =
      item.type === 'transfer'
        ? `${walletName(item.walletId)} → ${walletName(item.toWalletId)}`
        : `${item.category} · ${walletName(item.walletId)}`;
    return (
      <li key={item.id} className={cx('fav-item', `fav-item--${style}`)}>
        <button
          type="button"
          className={cx('fav-tile', `fav-c-${item.color}`, saving && 'is-busy')}
          aria-label={label(item)}
          aria-busy={saving || undefined}
          aria-haspopup="menu"
          onPointerDown={(event) => onPointerDown(event, item)}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(event) => onContextMenu(event, item)}
          onClick={() => onClick(item)}
        >
          <FavouriteBadge fav={item} />
          <span className="fav-tile-text">
            <span className="fav-tile-name">{item.name}</span>
            {style === 'list' && <span className="fav-tile-sub">{sub}</span>}
            {style === 'list' && item.uses > 0 && (
              <span className="fav-tile-sub">
                {t('favourites.usedSummary', {
                  count: item.uses,
                  date: item.lastUsed ? formatDate(item.lastUsed, settings.locale) : '',
                })}
              </span>
            )}
          </span>
          {amountText(item) && (
            <span className={cx('fav-tile-amount', item.amount === null && 'is-ask', item.type === 'income' && 'text-positive')}>
              {saving ? t('favourites.saving') : amountText(item)}
            </span>
          )}
        </button>
        {/* The menu by pointer or keyboard, where there is no long-press. */}
        <button
          type="button"
          className="fav-more"
          aria-label={t('favourites.moreFor', { name: item.name })}
          aria-haspopup="menu"
          onClick={(event) => setMenu({ fav: item, anchor: event.currentTarget })}
        >
          <Icon icon={Ellipsis} size="sm" />
        </button>
      </li>
    );
  };

  const pick = (action: () => void) => {
    setMenu(null);
    action();
  };
  const menuFav = menu?.fav ?? null;
  const groups = style === 'chips' ? [{ group: '', favs: ordered }] : groupFavourites(ordered);
  const full = list.favs.length >= MAX_FAVOURITES;

  return (
    <Card
      className={cx('fav-card', `fav-card--${style}`, sizeClass)}
      title={t('favourites.title')}
      actions={
        <div className="cluster" style={{ gap: 4 }}>
          <Button size="sm" variant="ghost" onClick={() => fav.openManage()} aria-label={t('favourites.manage')} title={t('favourites.manage')}>
            <Icon icon={Settings2} size="sm" />
          </Button>
          <Button size="sm" onClick={() => fav.openEditor()} disabled={full} title={full ? t('favourites.full', { max: MAX_FAVOURITES }) : undefined}>
            <Icon icon={Plus} size="sm" />
            {t('favourites.add')}
          </Button>
        </div>
      }
    >
      <div ref={bodyRef} className="fav-body">
        {ordered.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Star} size="xl" />}
            title={t('favourites.emptyTitle')}
            description={t('favourites.emptyBody')}
            action={
              <Button variant="primary" onClick={() => fav.openEditor()}>
                {t('favourites.addFirst')}
              </Button>
            }
          />
        ) : (
          groups.map((section) => (
            <section key={section.group || '-'} className="fav-section" aria-label={section.group || undefined}>
              {section.group && <h3 className="fav-section-title section-label">{section.group}</h3>}
              <ul className={cx('fav-list', `fav-list--${style}`)}>{section.favs.map(tile)}</ul>
            </section>
          ))
        )}
      </div>

      <ToolPanel open={menu !== null} anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} label={menuFav?.name ?? ''}>
        {menuFav && (
          <div className="tool-list" role="menu" aria-label={menuFav.name}>
            <button type="button" role="menuitem" className="tool-row" onClick={() => pick(() => fav.openEditor(menuFav))}>
              <Icon icon={Pencil} size="sm" />
              <span>{t('favourites.edit')}</span>
            </button>
            <button type="button" role="menuitem" className="tool-row" onClick={() => pick(() => fav.openForm(menuFav))}>
              <Icon icon={SquarePen} size="sm" />
              <span>{t('favourites.saveWithChanges')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tool-row"
              aria-disabled={full || undefined}
              onClick={() => !full && pick(() => fav.duplicate(menuFav.id))}
            >
              <Icon icon={Copy} size="sm" />
              <span>{t('favourites.duplicate')}</span>
            </button>
            <button type="button" role="menuitem" className="tool-row" onClick={() => pick(() => fav.openManage())}>
              <Icon icon={MoveVertical} size="sm" />
              <span>{t('favourites.move')}</span>
            </button>
            <button type="button" role="menuitem" className="tool-row tool-row--danger" onClick={() => pick(() => setDeleting(menuFav))}>
              <Icon icon={Trash2} size="sm" />
              <span>{t('common.delete')}</span>
            </button>
          </div>
        )}
      </ToolPanel>

      <ConfirmDialog
        open={deleting !== null}
        title={t('favourites.deleteTitle', { name: deleting?.name ?? '' })}
        body={t('favourites.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleting) fav.remove(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
