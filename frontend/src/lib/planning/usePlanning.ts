import { useEffect, useMemo, useSyncExternalStore } from 'react';

import i18n from '../i18n';
import { setRouteRefresher } from '../routeRefresh';
import { toast } from '../toast';
import { useAuth } from '../../state/AuthContext';
import { PlanningStore, type PlanningState } from './store';
import { planningTransport } from './transport';

/**
 * One store per signed-in user, kept for the session so going back to
 * Planning paints from memory and refreshes behind it. Signing in as someone
 * else starts a new, empty one.
 */
let current: { userId: string; store: PlanningStore } | null = null;

function storeFor(userId: string): PlanningStore {
  if (current?.userId === userId) return current.store;
  const store = new PlanningStore(planningTransport, {
    onError: (message) => toast.error(message, i18n.t('planning.saveFailed')),
    onReorderRefused: () => toast.info(i18n.t('planning.reorderRefused')),
  });
  current = { userId, store };
  return store;
}

export interface PlanningView extends PlanningState {
  store: PlanningStore;
  /** The deployed Code.gs predates Planning. */
  backendMissing: boolean;
}

export function usePlanning(): PlanningView {
  const { user } = useAuth();
  const store = useMemo(() => storeFor(user?.id ?? ''), [user?.id]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    void store.load();
    /* Back to the tab after a while: refresh, as the request cache does. */
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - store.getState().loadedAt > 10_000) void store.load(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const unregister = setRouteRefresher('planning', () => store.load(true));
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      unregister();
    };
  }, [store]);

  return { ...state, store, backendMissing: state.errorCode === 'UNKNOWN_ACTION' };
}

/**
 * Home's "Due soon" card: the same session store, read without the page's
 * eager refreshing, because planProjects.list reads the whole Transactions
 * sheet on the server. It loads only while a card using it is mounted (the
 * card is only mounted when placed on Home), reuses whatever the session
 * already has, and refreshes only when that is older than `maxAgeMs`: on
 * mount and on coming back to the tab. Home's Refresh button always reloads.
 */
export const DUE_SOON_MAX_AGE_MS = 5 * 60_000;

export function usePlanningCached(maxAgeMs = DUE_SOON_MAX_AGE_MS): PlanningView {
  const { user } = useAuth();
  const store = useMemo(() => storeFor(user?.id ?? ''), [user?.id]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    const refreshIfOld = () => {
      const { loadedAt, data, errorCode } = store.getState();
      if (errorCode === 'UNKNOWN_ACTION') return;
      if (!data || Date.now() - loadedAt > maxAgeMs) void store.load(true);
    };
    refreshIfOld();
    const onFocus = () => {
      if (document.visibilityState === 'visible') refreshIfOld();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const unregister = setRouteRefresher('dashboard', () => store.load(true));
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      unregister();
    };
  }, [store, maxAgeMs]);

  return { ...state, store, backendMissing: state.errorCode === 'UNKNOWN_ACTION' };
}
