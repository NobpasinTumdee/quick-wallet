/**
 * The language switcher.
 *
 * Built on `Segmented`, the control this app already uses for a short, mutually
 * exclusive choice — wallet mode, transaction type, the payment presets on a
 * card bill. A bespoke dropdown would have been a second idiom for the same
 * job, and it would have needed its own focus trap, its own outside-click
 * handling and its own glass treatment, all of which `Segmented` already has.
 *
 * It only stays a segmented control while the list is short. Past four
 * languages the row stops fitting a phone, so it falls back to a `Select` —
 * which is also the point at which a native picker starts being the better
 * control anyway, because it scrolls and is searchable by keypress.
 *
 * Each language is labelled with its own endonym — "ไทย", not "Thai". Someone
 * who has landed in a language they cannot read has to be able to find their
 * own, and "Thai" is no help if the interface is already in Japanese.
 */

import { useTranslation } from 'react-i18next';

import { useLanguage } from '../hooks/useLanguage';
import { Language } from '../locales';
import { Field, Segmented, Select } from './ui';

/** Past this many, the row would wrap on a phone. */
const MAX_SEGMENTED = 4;

export function LanguageSelector({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { language, languages, setLanguage } = useLanguage();

  /* Not awaited, and failure is swallowed on purpose. The interface has already
     changed by the time this resolves — only the settings write can fail, and
     `save` toasts that itself. Re-throwing here would put a second error in
     front of someone whose UI is, visibly, in the language they asked for. */
  const choose = (code: Language) => void setLanguage(code).catch(() => undefined);

  return (
    <Field label={t('settings.language')} hint={t('settings.languageHint')} className={className}>
      {languages.length <= MAX_SEGMENTED ? (
        <Segmented<Language>
          value={language}
          onChange={choose}
          ariaLabel={t('settings.language')}
          options={languages.map((entry) => ({
            value: entry.code,
            label: (
              <span className="lang-option">
                <span className="lang-option-short">{entry.short}</span>
                <span className="lang-option-label">{entry.label}</span>
              </span>
            ),
          }))}
        />
      ) : (
        <Select value={language} onChange={(event) => choose(event.target.value as Language)}>
          {languages.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
