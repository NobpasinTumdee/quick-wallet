import { ChevronDown, ListOrdered } from 'lucide-react';
import { Fragment, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorTexts } from './CardLayoutEditor';
import { Icon } from './Icon';
import { Button } from './ui';
import { SIDEBAR_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { cx } from '../lib/format';
import { heightScope, rememberHeights, rememberedHeight } from '../lib/skeletonHeights';
import { useMobileV2 } from '../lib/mobileLayout';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { ArrangeEntryTexts, ArrangeTexts } from '../lib/layout/arrangeTexts';
import type { CatalogCardDef, CatalogCardId } from '../lib/layout/cardCatalog';
import {
  DrawnPositions,
  GridLayout,
  fitGridToWidth,
  gridArea,
  isPlaced,
  migrateV1,
  placeFlowLayout,
  readingOrder,
  serializeGridLayout,
  setGridCardFlags,
  toCardLayout,
} from '../lib/layout/gridModel';
import { setLayoutAvailable, setLayoutEditing, useLayoutEditing } from '../lib/layout/homeEditStore';
import type { SyncedLayoutFormat } from '../lib/layout/layoutFormats';
import { CardLayout, ownCards, updateCard } from '../lib/layout/layoutModel';
import { type CardOrder, isDefaultOrder, unpairedHalves, visibleIds } from '../lib/layout/orderModel';
import { useCardLayout, useEffectiveSpans, useGridMetrics } from '../lib/layout/useCardLayout';
import { useCardOrder } from '../lib/layout/useHomeOrder';
import { toast } from '../lib/toast';
import type { TranslationKey } from '../locales/en';
import { scrollBehavior } from '../lib/motion';

/* A card to bring into view once a page's cards are drawn (Open in Analytics
   from a copy on Home): page name -> card id, taken once. */
const pendingReveal = new Map<string, string>();

/** Asks the board of `page` to scroll `id` into view when it next draws (the top if the card is not shown there). */
export function revealCardOn(page: string, id: string) {
  pendingReveal.set(page, id);
}

/* Edit mode for the desktop layout: its own chunk, loaded when Customize is
   pressed — almost no visit to a page ever needs it. */
const CardLayoutEditor = lazyWithRetry(() => import('./CardLayoutEditor'));
/* Fetched only when Arrange is opened. */
const ArrangeSheet = lazyWithRetry(() => import('./ArrangeSheet'));

/**
 * A page of cards that can be rearranged: Home, Analytics.
 *
 * - 1000px and up (desktop with the sidebar): the cards on a 12-column grid,
 *   from the saved layout — or from the default, which reproduces the old
 *   6-column bento to the pixel. A placed layout (x/y/w/h in cells) is drawn
 *   exactly where it was put; a flow layout (the default, and anything saved
 *   before free placement) in order and width. Customize (in the top bar)
 *   opens the editor on a placed draft of what is on screen.
 * - Below 1000px (phones and tablets, Classic and New): the saved card
 *   order, its own key. Without one — or after a reset — the cards render
 *   exactly as they always did.
 *
 * The page keeps its cards' markup; it hands each one over as a function of
 * its size class, its first-version "Tall" step and `fill` (sized in grid
 * rows, so its content adapts to the height).
 */
export interface CardBoardConfig<Id extends string> {
  /** The edit flag's name (the top bar's Customize button sets it). */
  editPage: string;
  /** Storage names: `layout.<gridPage>` (+ an older one read only) and the phone order's format. */
  gridPage: string;
  legacyPage?: string;
  orderFormat: SyncedLayoutFormat<CardOrder<Id>>;
  registry: readonly CatalogCardDef<Id>[];
  /** The two-up half cards on a tablet. */
  halves: ReadonlySet<Id>;
  /** Children of the grid ahead of the cards, which never move (Analytics' Deep Analytics link). */
  leadCount?: number;
  /** Off: the page always draws its default and never reads, edits or syncs a layout. */
  customizable?: boolean;
  /** Off: below 1000px the page keeps its default order (no saved order is read or synced). */
  phoneOrder?: boolean;
  /** The editor's texts that name the page (Home's by default). */
  editorTexts?: EditorTexts;
  /** Arranging the cards below 1000px: the sheet's texts, its link and toasts. */
  arrange: { texts: ArrangeTexts; entry: ArrangeEntryTexts };
  /** Toasts after Done and Reset in the editor. */
  messages: { saved: TranslationKey; resetDone: TranslationKey };
}

export interface BoardItem<Id extends string> {
  id: Id;
  sizeClass: string;
  tall: boolean;
  collapsed: boolean;
}

export function useCardBoard<Id extends string>(config: CardBoardConfig<Id>, userId: string | undefined) {
  const { registry } = config;
  const customizable = config.customizable !== false;
  const owner = customizable ? userId : undefined;

  /* ---- Desktop (with the sidebar) ---- */
  const layoutActive = useMediaQuery(SIDEBAR_QUERY);
  const {
    layout: gridLayout,
    save: saveGridLayout,
    reset: resetLayout,
    isCustom,
  } = useCardLayout(config.gridPage, config.legacyPage, owner, registry, layoutActive && customizable);
  /* Flow layouts (the default, and every layout saved before free placement)
     are drawn and edited in order-and-width terms, exactly as before. */
  const layout = useMemo(() => toCardLayout(gridLayout, registry), [gridLayout, registry]);
  const saveLayout = (next: CardLayout<Id>) => saveGridLayout(migrateV1(next));
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
  const gridMetrics = useGridMetrics(gridElement, layoutActive);

  /* Each card's drawn width in a flow layout on this screen. */
  const spans = useEffectiveSpans(layout, registry, gridMetrics);

  /* A placed layout (cards with x/y/w/h in cells) as drawn on this screen:
     a card too narrow here is widened and the rest reflows. */
  const placedLayout =
    layoutActive && isPlaced(gridLayout) ? fitGridToWidth(gridLayout, registry, gridMetrics.width, gridMetrics.gap) : null;

  /* Edit mode works on cells. Opening it on a flow layout turns what is on
     screen into a placed draft — every card where it is, as tall as it
     measures, rounded to whole rows — so editing starts from exactly what
     you see. Done saves the draft only if something changed, so opening
     and closing never converts a layout by itself. Cancel drops it; leaving
     the page or going below the sidebar breakpoint ends it without saving. */
  const editing = useLayoutEditing(config.editPage) && layoutActive && customizable;
  const [draft, setDraft] = useState<GridLayout<Id> | null>(null);
  const draftStart = useRef('');
  if (editing && !draft) {
    let start: GridLayout<Id>;
    if (placedLayout) {
      start = placedLayout;
    } else {
      /* Read from the flow grid still on screen: its children (after any
         fixed lead) are the visible cards, in order — each kept where it is
         drawn, so nothing moves when editing starts, even where the grid has
         back-filled an earlier gap with a later card. */
      const visible = layout.cards.filter((card) => !card.hidden);
      const children = gridElement ? (Array.from(gridElement.children) as HTMLElement[]).slice(config.leadCount ?? 0) : [];
      const heights: Record<string, number> = {};
      let drawn: DrawnPositions | undefined;
      /* Not from skeletons (Customize pressed while the page loads): order packing, as before. */
      const drawnReal = gridElement !== null && !gridElement.querySelector('.sk-card');
      if (gridElement && drawnReal && children.length === visible.length) {
        const frame = gridElement.getBoundingClientRect();
        const style = getComputedStyle(gridElement);
        const left = frame.left + (parseFloat(style.paddingLeft) || 0) + gridElement.clientLeft;
        const top = frame.top + (parseFloat(style.paddingTop) || 0) + gridElement.clientTop;
        const boxes: Record<string, { top: number; left: number }> = {};
        visible.forEach((card, index) => {
          const box = children[index].getBoundingClientRect();
          heights[card.id] = children[index].offsetHeight;
          boxes[card.id] = { top: box.top - top, left: box.left - left };
        });
        drawn = { boxes, pitch: (gridMetrics.width + gridMetrics.gap) / 12 };
      }
      start = fitGridToWidth(
        placeFlowLayout(gridLayout, registry, spans, heights, gridMetrics.gap || 24, drawn),
        registry,
        gridMetrics.width,
        gridMetrics.gap,
      );
    }
    /* Cards that can be added from another page (Analytics cards on Home) and
       are not here yet join the draft hidden, so the panel offers them like
       any hidden card; Done drops any still hidden (hiding one removes it). */
    const missing = registry.filter((def) => def.addable && !start.cards.some((card) => card.id === def.id));
    draftStart.current = serializeGridLayout(withoutHiddenAddable(start));
    setDraft(missing.length ? { ...start, cards: [...start.cards, ...missing.map((def) => ({ id: def.id, w: def.defaultW, hidden: true as const }))] } : start);
  }
  if (!editing && draft) setDraft(null);
  const { editPage } = config;
  useEffect(() => {
    if (!layoutActive) setLayoutEditing(editPage, false);
  }, [layoutActive, editPage]);
  useEffect(() => () => setLayoutEditing(editPage, false), [editPage]);

  /* ---- Below 1000px: the card order ---- */
  const phoneOrder = customizable && config.phoneOrder !== false;
  const order = useCardOrder(config.orderFormat, registry, phoneOrder ? userId : undefined, !layoutActive && phoneOrder);
  const [arrangeOpen, setArrangeOpen] = useState(false);

  /* Below 1000px: the registry's own order, no size classes — the bento as it
     always was — or the saved order. At 1000px and up: the layout's order and
     drawn widths, hidden cards left out. */
  const placed: BoardItem<Id>[] = layoutActive
    ? layout.cards
        .filter((card) => !card.hidden)
        .map((card) => ({ id: card.id, sizeClass: `lspan-${spans[card.id] ?? card.w}`, tall: card.h === 'tall', collapsed: !!card.collapsed }))
    : /* A saved order that is the default draws as the default (on a tablet
         the grid may back-fill a half card beside another, as it always has). */
      order.isCustom && !isDefaultOrder(order.order, registry)
      ? orderedCards(visibleIds(order.order))
      : ownCards(registry).map((def) => ({ id: def.id, sizeClass: '', tall: false, collapsed: false }));

  /* A phone order says nothing about sizes. On a tablet the two half cards
     sit side by side only when they are next to each other; one on its own
     is drawn full width there (`mspan-full`, which does nothing on a phone). */
  function orderedCards(ids: Id[]): BoardItem<Id>[] {
    const full = unpairedHalves(ids, config.halves);
    return ids.map((id) => ({ id, sizeClass: full.has(id) ? 'mspan-full' : '', tall: false, collapsed: false }));
  }

  /** Expands a collapsed card (from its bar on the page). Saves. */
  const expand = (id: Id) =>
    isPlaced(gridLayout)
      ? saveGridLayout(setGridCardFlags(gridLayout, id, { collapsed: false }))
      : saveLayout(updateCard(layout, registry, id, { collapsed: false }));

  /** An added card hidden in the editor is removed: it is not this page's own. */
  function withoutHiddenAddable(next: GridLayout<Id>): GridLayout<Id> {
    if (!next.cards.some((card) => card.hidden && registry.find((def) => def.id === card.id)?.addable)) return next;
    return { ...next, cards: next.cards.filter((card) => !(card.hidden && registry.find((def) => def.id === card.id)?.addable)) };
  }

  const finishEditing = (draftLayout: GridLayout<Id> | null, savedMessage: string) => {
    const next = draftLayout && withoutHiddenAddable(draftLayout);
    if (next && serializeGridLayout(next) !== draftStart.current) {
      saveGridLayout(next);
      toast.success(savedMessage);
    }
    setLayoutEditing(editPage, false);
  };

  return {
    config,
    /** Whose skeleton heights these are (see skeletonHeights.ts). */
    userId,
    layoutActive,
    isCustom,
    gridMetrics,
    setGridElement,
    placedLayout,
    placed,
    editing,
    draft,
    setDraft,
    finishEditing,
    resetLayout,
    expand,
    order,
    arrangeOpen,
    openArrange: () => setArrangeOpen(true),
    closeArrange: () => setArrangeOpen(false),
  };
}

export type CardBoardState<Id extends string> = ReturnType<typeof useCardBoard<Id>>;

/**
 * The board's grid: the placed layout, the flow layout, the phone order, or
 * the editor. `lead` goes ahead of the cards and never moves; `empty` is
 * what shows below 1000px when every card is hidden.
 */
export function CardBoardGrid<Id extends string>({
  board,
  renderCard,
  lead,
  empty,
  loading = false,
  skeleton,
}: {
  board: CardBoardState<Id>;
  renderCard: (id: Id, sizeClass: string, tall: boolean, fill: boolean) => ReactNode;
  lead?: ReactNode;
  empty: ReactNode;
  /** The page's data is not here yet: each card draws `skeleton` in its own place and size. */
  loading?: boolean;
  /** A card's skeleton; `minHeight` is its height when it last loaded on this screen (flow layouts). */
  skeleton?: (id: Id, sizeClass: string, minHeight: number | undefined, tall: boolean) => ReactNode;
}) {
  const { t } = useTranslation();
  const { config, layoutActive, isCustom, placedLayout, placed, setGridElement } = board;
  const mobileV2 = useMobileV2();
  const skeletons = loading && skeleton !== undefined;

  /* The top bar offers Customize while the cards are on screen — once they
     are real: the editor works on loaded cards. */
  useEffect(() => {
    if (skeletons) return undefined;
    setLayoutAvailable(config.editPage, true);
    return () => setLayoutAvailable(config.editPage, false);
  }, [config.editPage, skeletons]);

  /* Open in Analytics: the card asked for, once the grid is drawn. Its
     element is found by position, so the page's markup needs no ids: a
     placed grid has one wrapper per card in reading order, a flow grid the
     cards themselves after any fixed lead. */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const ids = placedLayout ? readingOrder(placedLayout.cards).map((card) => card.id as string) : placed.map((item) => item.id as string);
  const leadInGrid = placedLayout || (!layoutActive && placed.length === 0) ? 0 : (config.leadCount ?? 0);
  useEffect(() => {
    const want = pendingReveal.get(config.editPage);
    const grid = gridRef.current;
    if (want === undefined || !grid || skeletons) return undefined;
    const index = ids.indexOf(want);
    /* Taken inside the frame, so an effect that is cleaned up before it runs
       (StrictMode, a quick re-render) leaves the request for the next one. */
    const frame = window.requestAnimationFrame(() => {
      if (pendingReveal.get(config.editPage) !== want) return;
      pendingReveal.delete(config.editPage);
      const target = index >= 0 ? (grid.children[leadInGrid + index] as HTMLElement | undefined) : undefined;
      if (!target) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }
      /* Clear of the sticky top bar. */
      const bar = document.querySelector<HTMLElement>('.topbar');
      const offset = (bar?.getBoundingClientRect().height ?? 64) + 12;
      window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: scrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  });
  /* Skeleton heights: where the layout does not fix a card's height (flow
     layouts, phones), each card's drawn height once the page has loaded and
     settled, kept for its skeleton next time (skeletonHeights.ts). */
  const scope = heightScope(config.editPage, typeof window === 'undefined' ? 0 : window.innerWidth, mobileV2);
  const idKey = ids.join(',');
  useEffect(() => {
    if (skeletons || board.editing || placedLayout || !board.userId) return undefined;
    const timer = window.setTimeout(() => {
      const grid = gridRef.current;
      if (!grid) return;
      const heights: Record<string, number> = {};
      ids.forEach((id, index) => {
        const element = grid.children[leadInGrid + index] as HTMLElement | undefined;
        if (element) heights[id] = element.getBoundingClientRect().height;
      });
      rememberHeights(board.userId, scope, heights);
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skeletons, board.editing, placedLayout, board.userId, scope, idKey, leadInGrid]);

  /** A card, or its skeleton while the page loads. */
  const draw = (id: Id, sizeClass: string, tall: boolean, fill: boolean) =>
    skeletons ? skeleton!(id, sizeClass, fill ? undefined : rememberedHeight(board.userId, scope, id), tall) : renderCard(id, sizeClass, tall, fill);

  const attachGrid = (element: HTMLDivElement | null) => {
    gridRef.current = element;
    setGridElement(element);
  };

  /* A collapsed card: its title and a way back. Expanding saves. */
  const collapsedBar = (id: Id, sizeClass: string) => {
    const def = config.registry.find((item) => item.id === id)!;
    const title = t(def.titleKey);
    return (
      <section className={cx('card lcollapsed', sizeClass)} aria-label={title}>
        <span className="lcollapsed-title truncate">{title}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={false}
          aria-label={t('layout.expandCard', { title })}
          onClick={() => board.expand(id)}
        >
          <Icon icon={ChevronDown} size="sm" />
          {t('layout.expand')}
        </Button>
      </section>
    );
  };

  /* A placed layout: each card in its own cells, sized in rows, its content
     filling exactly that. Cards are in reading order, so Tab and a screen
     reader go top to bottom, left to right. */
  const plainBento = placedLayout ? (
    <>
      {lead}
      <div ref={attachGrid} className="bento layout-12 is-custom is-placed">
        {readingOrder(placedLayout.cards).map((card) => (
          <div key={card.id} className="lplace" style={gridArea(card)}>
            {card.collapsed ? collapsedBar(card.id, '') : draw(card.id, '', false, true)}
          </div>
        ))}
      </div>
    </>
  ) : !layoutActive && placed.length === 0 ? (
    <>
      {lead}
      {empty}
    </>
  ) : (
    <div
      ref={attachGrid}
      className={cx('bento', layoutActive && 'layout-12', layoutActive && isCustom && 'is-custom')}
    >
      {lead}
      {placed.map((item) => (
        <Fragment key={item.id}>
          {item.collapsed ? collapsedBar(item.id, item.sizeClass) : draw(item.id, item.sizeClass, item.tall, false)}
        </Fragment>
      ))}
    </div>
  );

  /* One polite "Loading…" for the page; the skeletons are hidden from screen readers. */
  if (skeletons) {
    return (
      <>
        {plainBento}
        <span className="sr-only" role="status">
          {t('common.loading')}
        </span>
      </>
    );
  }
  if (!(board.editing && board.draft)) return plainBento;
  const draft = board.draft;
  return (
    <>
      <Suspense fallback={plainBento}>
        {lead}
        <CardLayoutEditor
          registry={config.registry}
          draft={draft}
          onChange={(next) => board.setDraft(next as GridLayout<Id>)}
          metrics={board.gridMetrics}
          renderCard={(id) => renderCard(id as Id, '', false, true)}
          gridRef={setGridElement}
          gridClassName="bento layout-12 is-custom is-placed"
          onDone={() => board.finishEditing(draft, t(config.messages.saved))}
          onCancel={() => board.finishEditing(null, '')}
          texts={config.editorTexts}
          onReset={() => {
            board.resetLayout();
            setLayoutEditing(config.editPage, false);
            toast.success(t(config.messages.resetDone));
          }}
        />
      </Suspense>
    </>
  );
}

/**
 * The Arrange sheet for this board, once opened (below 1000px): the page's
 * cards in order with ↑ / ↓ and a show switch. Saves or resets the board's
 * own order and says so.
 */
export function CardBoardArrange<Id extends string>({ board }: { board: CardBoardState<Id> }) {
  const { t } = useTranslation();
  const { config } = board;
  if (!board.arrangeOpen) return null;
  const { texts, entry } = config.arrange;
  type AnyOrder = CardOrder<CatalogCardId>;
  return (
    <Suspense fallback={null}>
      <ArrangeSheet
        registry={config.registry as unknown as readonly CatalogCardDef<CatalogCardId>[]}
        texts={texts}
        order={board.order.order as unknown as AnyOrder}
        onClose={board.closeArrange}
        onSave={(next: AnyOrder) => {
          board.order.save(next as unknown as CardOrder<Id>);
          board.closeArrange();
          toast.success(t(entry.saved));
        }}
        onReset={() => {
          board.order.reset();
          board.closeArrange();
          toast.success(t(entry.resetDone));
        }}
      />
    </Suspense>
  );
}

/** Every card hidden below 1000px: what is left of the page stays, with a way back. */
export function CardBoardArrangeEmpty<Id extends string>({ board }: { board: CardBoardState<Id> }) {
  const { t } = useTranslation();
  const { entry } = board.config.arrange;
  return (
    <div className="home-arrange-empty">
      <p>{t(entry.allHidden)}</p>
      <Button size="sm" onClick={board.openArrange}>
        <Icon icon={ListOrdered} size="sm" />
        {t(entry.open)}
      </Button>
    </div>
  );
}

/** The page's "Arrange" link (New layout, below 1000px; styled out of the flow). */
export function CardBoardArrangeLink<Id extends string>({ board }: { board: CardBoardState<Id> }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="home-arrange-link" onClick={board.openArrange}>
      <Icon icon={ListOrdered} size="sm" />
      {t(board.config.arrange.entry.open)}
    </button>
  );
}
