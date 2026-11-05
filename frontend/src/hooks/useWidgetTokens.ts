import { useCallback, useState } from 'react';

import { api } from '../api/client';
import { WidgetToken, WidgetTokenPayload, WidgetTokenSecret } from '../types';
import { useExcelQuery } from './useExcelDB';

/**
 * The signed-in user's widget tokens.
 *
 * Not an optimistic collection like the money tables: a token's secret only
 * exists in the server's reply, so every write waits for it and then reloads
 * the list. There are at most ten of them, so the reload is cheap.
 */
export function useWidgetTokens() {
  const query = useExcelQuery<WidgetToken[]>('/api/widgetTokens');
  const [busy, setBusy] = useState(false);
  const { refresh } = query;

  const run = useCallback(
    async <T>(call: () => Promise<T>): Promise<T> => {
      setBusy(true);
      try {
        const result = await call();
        await refresh();
        return result;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return {
    ...query,
    items: query.data ?? [],
    busy,
    create: (payload: WidgetTokenPayload) =>
      run(() => api.post<WidgetTokenSecret>('/api/widgetTokens', payload)),
    update: (id: string, payload: Partial<WidgetTokenPayload>) =>
      run(() => api.patch<WidgetToken>(`/api/widgetTokens/${encodeURIComponent(id)}`, payload)),
    regenerate: (id: string) =>
      run(() => api.post<WidgetTokenSecret>(`/api/widgetTokens/${encodeURIComponent(id)}/regenerate`)),
    revoke: (id: string) =>
      run(() => api.post<WidgetToken>(`/api/widgetTokens/${encodeURIComponent(id)}/revoke`)),
  };
}
