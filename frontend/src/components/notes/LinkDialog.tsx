import { FileText } from 'lucide-react';
import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normaliseUrl } from '../../lib/markdownEdit';
import { noteLinkUrl } from '../../lib/noteFormat';
import { compareNotes, matchesNoteSearch } from '../../lib/notes';
import { Note } from '../../types';
import { Icon } from '../Icon';
import { Button, Field, Input, Modal, Segmented } from '../ui';

export type LinkTab = 'web' | 'note';

/**
 * A link: to a web address, or to another note.
 *
 * Web: link text and an address. The text is optional — without it the
 * address itself goes in, which the reading view shortens — and the address
 * is checked here, so a note never gains a `javascript:` or `data:` link from
 * this dialog. A missing scheme gets `https://`.
 *
 * Note: a searchable list of the other notes. Choosing one inserts
 * `[its title](#/notes?id=…)`, or the selected words as the text.
 */
export function LinkDialog({
  open,
  initialText,
  initialTab = 'web',
  notes,
  currentId,
  onInsert,
  onClose,
}: {
  open: boolean;
  initialText: string;
  initialTab?: LinkTab;
  /** Every note, for the Note tab. */
  notes: Note[];
  /** The note being edited, which is left out of the list. */
  currentId: string | null;
  onInsert: (label: string, url: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [tab, setTab] = useState<LinkTab>(initialTab);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setLabel(initialText);
    setUrl('');
    setError(false);
    setSearch('');
  }, [open, initialText, initialTab]);

  const others = useMemo(() => notes.filter((note) => note.id !== currentId).sort(compareNotes), [notes, currentId]);
  const found = useMemo(() => others.filter((note) => matchesNoteSearch(note, search)).slice(0, 50), [others, search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normaliseUrl(url);
    if (!clean) {
      setError(true);
      return;
    }
    onInsert(label, clean);
  }

  function pickNote(note: Note) {
    onInsert(initialText.trim() || note.title.trim() || t('notes.untitled'), noteLinkUrl(note.id));
  }

  return (
    <Modal
      open={open}
      title={t('notes.linkTitle')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {tab === 'web' && (
            <Button variant="primary" type="submit" form={formId}>
              {t('notes.linkInsert')}
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <Segmented<LinkTab>
          value={tab}
          ariaLabel={t('notes.linkTitle')}
          options={[
            { value: 'web', label: t('notes.linkTabWeb') },
            { value: 'note', label: t('notes.linkTabNote') },
          ]}
          onChange={setTab}
        />

        {tab === 'web' ? (
          <form id={formId} className="stack" onSubmit={submit} noValidate>
            <Field label={t('notes.linkText')} hint={t('notes.linkTextHint')}>
              <Input
                value={label}
                maxLength={200}
                onChange={(event) => setLabel(event.target.value)}
                enterKeyHint="next"
                data-autofocus={initialTab === 'web' && !initialText ? '' : undefined}
              />
            </Field>
            <Field label={t('notes.linkUrl')} error={error ? t('notes.linkInvalid') : undefined}>
              <Input
                value={url}
                inputMode="url"
                type="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://example.com"
                aria-invalid={error || undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(false);
                }}
                enterKeyHint="done"
                /* With the text already filled from the selection, start at the address. */
                data-autofocus={initialTab === 'web' && initialText ? '' : undefined}
              />
            </Field>
          </form>
        ) : (
          <div className="stack link-notes">
            <Input
              type="search"
              value={search}
              placeholder={t('notes.linkNoteSearch')}
              aria-label={t('notes.linkNoteSearch')}
              maxLength={80}
              onChange={(event) => setSearch(event.target.value)}
              data-autofocus={initialTab === 'note' ? '' : undefined}
            />
            {others.length === 0 ? (
              <p className="link-notes-empty">{t('notes.linkNoteNone')}</p>
            ) : found.length === 0 ? (
              <p className="link-notes-empty">{t('notes.linkNoteEmpty')}</p>
            ) : (
              <ul className="link-notes-list" role="list">
                {found.map((note) => (
                  <li key={note.id}>
                    <button type="button" className="link-notes-item" onClick={() => pickNote(note)}>
                      <Icon icon={FileText} size="sm" />
                      <span>{note.title.trim() || t('notes.untitled')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
