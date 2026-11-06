import { type CatalogCardDef, type HomeCardId, HOME_CATALOG } from './cardCatalog';

/**
 * Home's slice of the card catalog (cardCatalog.ts): its cards, in today's
 * order and at today's sizes, and the names its layouts are stored under.
 */
export type { HomeCardId } from './cardCatalog';
export { HOME_TABLET_HALVES } from './cardCatalog';

export type HomeCardDef = CatalogCardDef<HomeCardId>;

export const HOME_CARDS: readonly HomeCardDef[] = HOME_CATALOG;

/**
 * The layout's storage name: `qw.layout.<page>.<userId>` on this device and
 * `layout.<page>` on the server. Free placement has its own name, so the
 * first version's value — `home` — is only ever read (to migrate it), never
 * written, and a PC still running that version keeps its own copy.
 */
export const HOME_LAYOUT_PAGE = 'home-grid';
export const HOME_LEGACY_LAYOUT_PAGE = 'home';

/**
 * The phone's Home (below 1000px — phones and tablets, Classic and New):
 * card order and which cards show, its own key, separate from the desktop's.
 */
export const HOME_ORDER_PAGE = 'home-mobile';
