import { useCallback } from 'react';

import { CollectionState, useExcelDB } from './useExcelDB';
import { Goal } from '../types';

/**
 * Sinking funds.
 *
 * A thin wrapper over `useExcelDB`, plus the one operation that cannot be a
 * plain update: funding.
 */
export interface GoalsState extends CollectionState<Goal> {
  /**
   * Moves `amount` into or out of a goal. Negative withdraws.
   *
   * -----------------------------------------------------------------------
   * WHY THIS SENDS A DELTA AND NOT A NEW BALANCE
   * -----------------------------------------------------------------------
   * The obvious client-side version reads `savedAmount`, adds to it, and PATCHes
   * the result. Two tabs — or a phone and a laptop — each read 1,000, each write
   * 1,500, and one of the two deposits disappears with no error anywhere.
   *
   * So the server takes the delta and resolves it against the row as it actually
   * is, under the script lock. The optimistic patch here still has to guess, but
   * it is only ever a guess: the reconcile step overwrites it with the row the
   * server computed, so a concurrent write corrects itself on the next tick
   * instead of being silently lost.
   */
  fund: (goal: Goal, amount: number) => Promise<Goal>;
}

export function useGoals(): GoalsState {
  const collection = useExcelDB<Goal>('goals');
  const { action } = collection;

  const fund = useCallback(
    (goal: Goal, amount: number) => action<Goal>(goal.id, 'fund', { amount }),
    [action],
  );

  return { ...collection, fund };
}
