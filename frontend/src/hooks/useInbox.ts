import { useCallback, useMemo } from 'react';

import { CollectionState, useExcelDB } from './useExcelDB';
import { InboxSummary, summarizeInbox } from '../lib/inbox';
import { InboxItem, InboxType } from '../types';

/**
 * The financial inbox.
 *
 * A thin wrapper over `useExcelDB` — the table is ordinary CRUD — plus the two
 * state changes that are actions rather than edits: resolving an item and
 * putting it back.
 *
 * Note what is *not* here: nothing that writes a Transaction. Converting an
 * item to a real expense goes through the transaction endpoint like any other
 * entry, and only the resulting id is handed back to `resolve`. See the note
 * above `inboxResolve_` in Code.gs.
 */
export interface NewInboxItem {
  text: string;
  /** 0 or omitted for a plain reminder. */
  amount?: number;
  /** `YYYY-MM-DD`, or omitted. */
  dueDate?: string;
  type?: InboxType;
}

export interface InboxState extends CollectionState<InboxItem> {
  /** Open items, server-ordered: soonest due first, undated last. */
  pending: InboxItem[];
  summary: InboxSummary;
  add: (item: NewInboxItem) => Promise<InboxItem>;
  /**
   * Closes an item. `transactionId` links the entry the user recorded for it,
   * when they chose to record one.
   */
  resolveItem: (id: string, transactionId?: string) => Promise<InboxItem>;
  /** Undo for a mis-tapped checkbox. */
  reopenItem: (id: string) => Promise<InboxItem>;
}

export function useInbox(): InboxState {
  const collection = useExcelDB<InboxItem>('inbox');
  const { action, create, items } = collection;

  const pending = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);
  const summary = useMemo(() => summarizeInbox(items), [items]);

  const add = useCallback(
    (item: NewInboxItem) =>
      create({
        text: item.text.trim(),
        amount: item.amount ?? 0,
        dueDate: item.dueDate ?? '',
        type: item.type ?? 'note',
      }),
    [create],
  );

  /* `action` is the right tool here, unlike on goals.purchase: these endpoints
     answer with the item itself, so merging the response onto the row is
     exactly what should happen, and nothing outside this collection moves. */
  const resolveItem = useCallback(
    (id: string, transactionId?: string) =>
      action<InboxItem>(id, 'resolve', transactionId ? { transactionId } : {}),
    [action],
  );

  const reopenItem = useCallback((id: string) => action<InboxItem>(id, 'reopen'), [action]);

  return { ...collection, pending, summary, add, resolveItem, reopenItem };
}
