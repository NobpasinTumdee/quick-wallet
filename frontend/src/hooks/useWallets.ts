import { useCallback } from 'react';

import { CollectionState, useExcelDB } from './useExcelDB';
import { WalletBalance } from '../types';

/**
 * Wallets, plus the one write that has to prove who is asking.
 *
 * ---------------------------------------------------------------------------
 * WHY DELETING TAKES A PASSWORD
 * ---------------------------------------------------------------------------
 * Every other destructive action in this app removes one row that the user can
 * put back by retyping it. Deleting a wallet can take its whole history with
 * it — every transaction, every investment, every budget pointed at it — and
 * nothing in a spreadsheet undoes that.
 *
 * So it is the one action that re-authenticates. The check happens on the
 * server, in the same locked request as the deletion, which is what makes it
 * worth anything: a modal that only gates the button is a modal somebody can
 * skip by calling the API directly.
 */
export interface WalletsState extends CollectionState<WalletBalance> {
  /**
   * Deletes a wallet after the server re-checks `password`.
   *
   * The password goes in the request *body*, never in params: non-GET requests
   * are serialised into the POST envelope, so a body keeps the secret out of
   * URLs, browser history and request logs. The server reads it from there and
   * nowhere else.
   *
   * `cascade` is the second attempt. The server refuses to delete a wallet
   * that still has records unless it is asked explicitly, and answers with the
   * counts — which is what the modal shows before asking again.
   */
  deleteWallet: (id: string, password: string, options?: { cascade?: boolean }) => Promise<void>;
}

export function useWallets(): WalletsState {
  const collection = useExcelDB<WalletBalance>('wallets');
  const { remove } = collection;

  const deleteWallet = useCallback(
    (id: string, password: string, options: { cascade?: boolean } = {}) =>
      remove(
        id,
        options.cascade ? { cascade: true } : undefined,
        /* Body, not params. The distinction is the whole point — see above. */
        { password },
      ),
    [remove],
  );

  return { ...collection, deleteWallet };
}
