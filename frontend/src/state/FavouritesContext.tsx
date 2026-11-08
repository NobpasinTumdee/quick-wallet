import { type ReactNode, Suspense, createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { TransactionPayload } from '../components/TransactionForm';
import type { FavouritesRequest } from '../components/favourites/FavouritesHost';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { WalletBalance } from '../types';

/*
 * Favourites, split in two so the main bundle carries almost none of it:
 *
 *  - this launcher (main bundle): a few bytes that say whether favourites are
 *    in use, and queue "make a favourite from this" until the rest arrives;
 *  - FavouritesHost (its own chunk): the list, its sync, the one-tap engine
 *    and its sheets. Mounted beside the app the first time anything uses
 *    favourites: the Home card, "Save as favourite", "Make favourite", or a
 *    ?fav= link. Home without the card never loads it, and makes exactly the
 *    requests it made before.
 */
const FavouritesHost = lazyWithRetry(() =>
  import('../components/favourites/FavouritesHost').then((m) => ({ default: m.FavouritesHost })),
);

/** The transaction fields a favourite is made from. */
export interface FavouriteSource {
  type: 'expense' | 'income' | 'transfer';
  walletId: string;
  toWalletId?: string;
  category?: string;
  note?: string;
  amount?: number | null;
}

interface FavouritesLauncher {
  /** Load and start favourites (the Home card does this when it mounts). */
  activate: () => void;
  /** The favourite editor, filled in from a transaction. */
  makeFromTransaction: (tx: FavouriteSource) => void;
}

const LauncherContext = createContext<FavouritesLauncher | null>(null);

/** Null outside the shell (a page rendered on its own, a test). */
export function useOptionalFavourites(): FavouritesLauncher | null {
  return useContext(LauncherContext);
}

function hasFavLink(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('fav');
  } catch {
    return false;
  }
}

export function FavouritesProvider({
  wallets,
  walletsLoading,
  onOpenForm,
  children,
}: {
  wallets: WalletBalance[];
  walletsLoading: boolean;
  onOpenForm: (prefill: Partial<TransactionPayload>) => void;
  children: ReactNode;
}) {
  const [active, setActive] = useState(hasFavLink);
  const [requests, setRequests] = useState<FavouritesRequest[]>([]);

  const activate = useCallback(() => setActive(true), []);
  const makeFromTransaction = useCallback((tx: FavouriteSource) => {
    setActive(true);
    setRequests((prev) => [...prev, { kind: 'fromTransaction', tx }]);
  }, []);
  const onHandled = useCallback((count: number) => setRequests((prev) => prev.slice(count)), []);
  const launcher = useMemo(() => ({ activate, makeFromTransaction }), [activate, makeFromTransaction]);

  return (
    <LauncherContext.Provider value={launcher}>
      {children}
      {active && (
        <Suspense fallback={null}>
          <FavouritesHost
            wallets={wallets}
            walletsLoading={walletsLoading}
            onOpenForm={onOpenForm}
            requests={requests}
            onHandled={onHandled}
          />
        </Suspense>
      )}
    </LauncherContext.Provider>
  );
}
