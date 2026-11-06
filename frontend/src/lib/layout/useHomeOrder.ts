import { useCallback, useMemo } from 'react';

import { HOME_CARDS } from './homeCards';
import { type CardOrder, type OrderCardDef, defaultOrder, isDefaultOrder } from './orderModel';
import { HOME_ORDER_FORMAT, type SyncedLayoutFormat } from './layoutFormats';
import { useSyncedLayout } from './useSyncedLayout';

/**
 * A page's card order and visibility below 1000px, kept on this device and
 * synced through UiPrefs exactly like the desktop layout (last write wins,
 * quiet without a Code.gs that has UiPrefs, Reset as a marker). `enabled` is
 * off at 1000px and up, where the desktop layout applies, so a PC never asks
 * the server about the phone's order.
 */
export function useCardOrder<Id extends string>(
  format: SyncedLayoutFormat<CardOrder<Id>>,
  registry: readonly OrderCardDef<Id>[],
  userId: string | undefined,
  enabled: boolean,
) {
  const { layout: order, save } = useSyncedLayout(format, userId, enabled);
  const reset = useCallback(() => save({ ...defaultOrder(registry), reset: true }), [save, registry]);
  const isCustom = useMemo(() => !isDefaultOrder(order, registry), [order, registry]);
  return { order, save, reset, isCustom };
}

/** Home's order (layout.home-mobile). */
export function useHomeOrder(userId: string | undefined, enabled: boolean) {
  return useCardOrder(HOME_ORDER_FORMAT, HOME_CARDS, userId, enabled);
}

export { HOME_ORDER_FORMAT } from './layoutFormats';
