import { Check, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '../../lib/format';
import { NAV_LABEL_KEYS } from '../../lib/navLabels';
import { NOTE_REF_ROUTE, NOTE_REF_TYPES, NOTE_REFS_MAX, sameRef } from '../../lib/notes';
import { NoteRef, NoteRefType } from '../../types';
import { Icon } from '../Icon';
import { Button, Modal, Segmented, Skeleton } from '../ui';
import { NOTE_REF_ICON } from './noteRefIcons';
import { ACTIVITY_LIMIT, useRefLists } from './useNoteRefData';

/** Rows drawn per tab. A search narrows the rest in; nobody scrolls 2,000. */
const VISIBLE_ROWS = 150;

function normalise(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

/**
 * Picks the records a note points at.
 *
 * Every tap toggles at once — there is no separate confirm step to forget,
 * and the editor autosaves the result like any other edit. "Done" only
 * closes. Lists load only for the open tab.
 */
export function NoteRefPicker({
  open,
  refs,
  onChange,
  onClose,
}: {
  open: boolean;
  refs: NoteRef[];
  onChange: (refs: NoteRef[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<NoteRefType>('goal');
  const [search, setSearch] = useState('');

  const wanted = useMemo(() => new Set<NoteRefType>(open ? [tab] : []), [open, tab]);
  const lists = useRefLists(wanted);
  const list = lists[tab];

  const matches = useMemo(() => {
    const words = normalise(search).split(/\s+/).filter(Boolean);
    if (words.length === 0) return list.options;
    return list.options.filter((option) => {
      const text = normalise(`${option.label} ${option.detail}`);
      return words.every((word) => text.includes(word));
    });
  }, [list.options, search]);

  const atLimit = refs.length >= NOTE_REFS_MAX;

  function toggle(ref: NoteRef) {
    if (refs.some((item) => sameRef(item, ref))) {
      onChange(refs.filter((item) => !sameRef(item, ref)));
    } else if (!atLimit) {
      onChange([...refs, ref]);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('notes.pickerTitle')}
      width={560}
      footer={
        <>
          <span className="note-picker-count">{t('notes.pickerSelected', { count: refs.length })}</span>
          <Button variant="primary" onClick={onClose}>
            {t('notes.pickerDone')}
          </Button>
        </>
      }
    >
      <div className="note-picker">
        {/* Five tabs do not fit one row at 320px in Thai, so the strip scrolls
            sideways inside itself rather than pushing the sheet wider. */}
        <div className="note-picker-tabs">
          <Segmented<NoteRefType>
            value={tab}
            ariaLabel={t('notes.references')}
            onChange={(next) => {
              setTab(next);
              setSearch('');
            }}
            options={NOTE_REF_TYPES.map((type) => ({
              value: type,
              label: (
                <span className="note-picker-tab">
                  <Icon icon={NOTE_REF_ICON[type]} size="sm" />
                  {t(NAV_LABEL_KEYS[NOTE_REF_ROUTE[type]])}
                </span>
              ),
            }))}
          />
        </div>

        <label className="notes-search">
          <Icon icon={Search} size="sm" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('notes.pickerSearch')}
            aria-label={t('notes.pickerSearch')}
            enterKeyHint="search"
          />
          {search && (
            <button
              type="button"
              className="notes-search-clear"
              aria-label={t('notes.clearSearch')}
              onClick={() => setSearch('')}
            >
              <Icon icon={X} size="sm" />
            </button>
          )}
        </label>

        {atLimit && <p className="note-picker-hint">{t('notes.refLimit', { max: NOTE_REFS_MAX })}</p>}
        {tab === 'transaction' && !list.loading && list.options.length > 0 && (
          <p className="note-picker-hint">
            {t('notes.pickerActivityHint', { count: Math.min(ACTIVITY_LIMIT, list.options.length) })}
          </p>
        )}

        {list.loading ? (
          <Skeleton rows={4} />
        ) : list.error ? (
          <p className="note-picker-empty">{t('notes.pickerLoadError')}</p>
        ) : list.options.length === 0 ? (
          <p className="note-picker-empty">{t('notes.pickerEmpty')}</p>
        ) : matches.length === 0 ? (
          <p className="note-picker-empty">{t('notes.pickerNoMatch')}</p>
        ) : (
          <ul className="note-picker-list" role="list">
            {matches.slice(0, VISIBLE_ROWS).map((option) => {
              const ref = { type: option.type, id: option.id };
              const selected = refs.some((item) => sameRef(item, ref));
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={cx('note-picker-row', selected && 'is-selected')}
                    aria-pressed={selected}
                    disabled={!selected && atLimit}
                    onClick={() => toggle(ref)}
                  >
                    <span className="note-picker-check" aria-hidden="true">
                      {selected && <Icon icon={Check} size="sm" />}
                    </span>
                    <span className="note-picker-text">
                      <span className="note-picker-label">{option.label}</span>
                      {option.detail && <span className="note-picker-detail">{option.detail}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
