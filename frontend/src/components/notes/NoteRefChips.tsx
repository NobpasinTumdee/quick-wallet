import { CircleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { NAV_LABEL_KEYS } from '../../lib/navLabels';
import { NOTE_REF_ROUTE } from '../../lib/notes';
import { NoteRef } from '../../types';
import { Icon } from '../Icon';
import { NOTE_REF_ICON } from './noteRefIcons';
import { RefList, RefOption, useSingleTransaction } from './useNoteRefData';

/**
 * The note's references, as chips.
 *
 * A reference to a record that has since been deleted still renders — as a
 * "Deleted record" chip that can be removed — rather than vanishing or
 * breaking the note: the pointer is the user's data, and silently dropping it
 * would lose the fact that the note was ever about something.
 */
export function NoteRefChips({
  refs,
  lists,
  onOpen,
  onRemove,
}: {
  refs: NoteRef[];
  lists: Record<NoteRef['type'], RefList>;
  onOpen: (ref: NoteRef, option: RefOption) => void;
  onRemove: (ref: NoteRef) => void;
}) {
  return (
    <ul className="note-refs" role="list">
      {refs.map((ref) => (
        <li key={`${ref.type}:${ref.id}`}>
          <RefChip refItem={ref} list={lists[ref.type]} onOpen={onOpen} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  );
}

function RefChip({
  refItem,
  list,
  onOpen,
  onRemove,
}: {
  refItem: NoteRef;
  list: RefList;
  onOpen: (ref: NoteRef, option: RefOption) => void;
  onRemove: (ref: NoteRef) => void;
}) {
  const { t } = useTranslation();
  const inList = list.options.find((option) => option.id === refItem.id) ?? null;
  /* An Activity row older than the shared list reaches: ask for it alone. */
  const single = useSingleTransaction(
    refItem.id,
    refItem.type === 'transaction' && !inList && !list.loading && !list.error,
  );

  const option = inList ?? single.option;
  const loading = !option && (list.loading || single.loading);
  const missing =
    !option &&
    !loading &&
    (refItem.type === 'transaction' ? single.missing : !list.error);

  const kind = t(NAV_LABEL_KEYS[NOTE_REF_ROUTE[refItem.type]]);
  const label = option?.label ?? (missing ? t('notes.missing') : '…');

  return (
    <span className={`note-ref${missing ? ' is-missing' : ''}`} title={missing ? t('notes.missingHint') : undefined}>
      <button
        type="button"
        className="note-ref-open"
        disabled={!option}
        aria-label={t('notes.openReference', { label: `${kind}: ${label}` })}
        onClick={() => option && onOpen(refItem, option)}
      >
        <Icon icon={missing ? CircleAlert : NOTE_REF_ICON[refItem.type]} size="sm" />
        <span className="note-ref-kind">{kind}</span>
        <span className="note-ref-label">{label}</span>
      </button>
      <button
        type="button"
        className="note-ref-remove"
        aria-label={t('notes.removeReference', { label: `${kind}: ${label}` })}
        onClick={() => onRemove(refItem)}
      >
        <Icon icon={X} size="sm" />
      </button>
    </span>
  );
}
