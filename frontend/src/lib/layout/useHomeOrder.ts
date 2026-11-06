import { useCallback, useMemo } from 'react';

import { HOME_CARDS } from './homeCards';
import { defaultOrder, isDefaultOrder } from './orderModel';
import { HOME_ORDER_FORMAT } from './layoutFormats';
import { useSyncedLayout } from './useSyncedLayout';

/**
 * The order and visibility of Home's cards below 1000px, kept on this device
 * and synced through UiPrefs exactly like the desktop layout (last write
 * wins, quiet without a Code.gs that has UiPrefs, Reset as a marker).
 * `enabled` is off at 1000px and up, where the desktop layout applies, so a
 * PC never asks the server about the phone's order.
 */
export function useHomeOrder(userId: string | undefined, enabled: boolean) {
  const { layout: order, save } = useSyncedLayout(HOME_ORDER_FORMAT, userId, enabled);
  const reset = useCallback(() => save({ ...defaultOrder(HOME_CARDS), reset: true }), [save]);
  const isCustom = useMemo(() => !isDefaultOrder(order, HOME_CARDS), [order]);
  return { order, save, reset, isCustom };
}

export { HOME_ORDER_FORMAT } from './layoutFormats';
