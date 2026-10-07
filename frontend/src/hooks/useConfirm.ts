import { useCallback, useState } from 'react';

/**
 * "Ask first, then do it" — the state every destructive action needs.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SUBJECT AND NOT A BOOLEAN
 * ---------------------------------------------------------------------------
 * A flag can say a dialog is open. It cannot say *which row* it is about, and
 * a confirmation that does not name what it is about to delete is barely
 * better than no confirmation — it is the dialog people dismiss because it
 * could be about anything.
 *
 * Holding the subject also removes a bug `window.confirm` made impossible to
 * have and easy to reintroduce: with a boolean plus a separate "pending id",
 * the two can disagree, and the row that gets deleted is not the row the
 * dialog named.
 *
 * ---------------------------------------------------------------------------
 * WHY `busy` LIVES HERE
 * ---------------------------------------------------------------------------
 * Because the dialog must survive a failure. If the delete throws, the subject
 * stays, the spinner stops, and the dialog is still on screen with a usable
 * button — rather than closing as though it had worked.
 */
export interface ConfirmState<T> {
  /** The thing awaiting confirmation, or null. */
  subject: T | null;
  open: boolean;
  busy: boolean;
  /** Raise the dialog for this subject. */
  ask: (subject: T) => void;
  /** Dismiss without acting. */
  cancel: () => void;
  /**
   * Run the action against the held subject.
   *
   * Closes only on success: a thrown error leaves the dialog open so the
   * person can read what happened and decide again.
   */
  run: (action: (subject: T) => Promise<unknown> | unknown) => Promise<void>;
}

export function useConfirm<T>(): ConfirmState<T> {
  const [subject, setSubject] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback((next: T) => setSubject(next), []);

  const cancel = useCallback(() => {
    /* Ignored mid-flight: cancelling a delete that has already reached the
       server would close the dialog over an action still happening. */
    setBusy((current) => {
      if (!current) setSubject(null);
      return current;
    });
  }, []);

  const run = useCallback(
    async (action: (subject: T) => Promise<unknown> | unknown) => {
      if (subject === null) return;
      setBusy(true);
      try {
        await action(subject);
        setSubject(null);
      } finally {
        setBusy(false);
      }
    },
    [subject],
  );

  return { subject, open: subject !== null, busy, ask, cancel, run };
}
