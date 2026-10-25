import { Pin, PinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { NAV_LABEL_KEYS } from '../../lib/navLabels';
import { NOTE_REF_ROUTE, countRefsByType, formatEditedAt, notePreview } from '../../lib/notes';
import { useSettings } from '../../state/SettingsContext';
import { Note } from '../../types';
import { Icon } from '../Icon';
import { NOTE_REF_ICON } from './noteRefIcons';

/**
 * The notes as rows: title, one line of the body, when it was last edited,
 * and which kinds of records it points at. The whole row opens the note; the
 * pin is its own button beside it, never nested inside.
 */
export function NoteList({
  notes,
  onOpen,
  onTogglePin,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onTogglePin: (note: Note) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  return (
    <ul className="note-list" role="list">
      {notes.map((note) => {
        const preview = notePreview(note.body);
        const chips = countRefsByType(note.refs);
        return (
          <li key={note.id} className={cx('note-row', note.pinned && 'is-pinned')}>
            <button type="button" className="note-row-main" onClick={() => onOpen(note)}>
              <span className="note-row-head">
                {note.pinned && (
                  <span className="note-row-pin" aria-label={t('notes.pinned')}>
                    <Icon icon={Pin} size="sm" />
                  </span>
                )}
                <span className={cx('note-row-title', !note.title.trim() && 'is-untitled')}>
                  {note.title.trim() || t('notes.untitled')}
                </span>
              </span>
              <span className={cx('note-row-preview', !preview && 'is-empty')}>
                {preview || t('notes.emptyPreview')}
              </span>
              <span className="note-row-meta">
                <span className="note-row-time">
                  {t('notes.editedAt', { time: formatEditedAt(note.updatedAt, settings.locale) })}
                </span>
                {chips.map(({ type, count }) => (
                  <span key={type} className="note-chip">
                    <Icon icon={NOTE_REF_ICON[type]} size="sm" />
                    {t('notes.refChip', { label: t(NAV_LABEL_KEYS[NOTE_REF_ROUTE[type]]), count })}
                  </span>
                ))}
              </span>
            </button>
            <button
              type="button"
              className="note-row-pin-toggle"
              aria-pressed={note.pinned}
              aria-label={note.pinned ? t('notes.unpin') : t('notes.pin')}
              title={note.pinned ? t('notes.unpin') : t('notes.pin')}
              onClick={() => onTogglePin(note)}
            >
              <Icon icon={note.pinned ? PinOff : Pin} size="sm" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
