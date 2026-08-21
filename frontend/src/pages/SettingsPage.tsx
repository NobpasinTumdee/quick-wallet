import { Check, RotateCcw } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

import { api } from '../api/client';
import { Icon } from '../components/Icon';
import {
  Alert,
  Badge,
  Button,
  Card,
  DecimalInput,
  Field,
  Input,
  RefreshButton,
  Select,
  decimalToInput,
  parseDecimal,
} from '../components/ui';
import { useExcelQuery } from '../hooks/useExcelDB';
import { cx, formatDate, formatMoney } from '../lib/format';
import { THEME_PRESETS, themePreset } from '../lib/themes';
import { COMMON_CURRENCIES, fetchRate } from '../services/fxApi';
import { hasLiveQuotes, providerName } from '../services/stockApi';
import { useAuth } from '../state/AuthContext';
import { useSettings } from '../state/SettingsContext';
import { DbHealth } from '../types';

const ACCENTS = ['#3b6fff', '#5b8cff', '#46c2a4', '#0f9d6b', '#d98324', '#dc3a56', '#8b5cf6', '#ec4899'];

/** The subset of CSS variables the custom theme exposes. */
const CUSTOM_VARS: { key: string; label: string; fallback: string }[] = [
  { key: '--bg', label: 'Page background', fallback: '#0f1a1c' },
  { key: '--surface', label: 'Card surface', fallback: '#16262a' },
  { key: '--surface-2', label: 'Input surface', fallback: '#1d3237' },
  { key: '--border', label: 'Borders', fallback: '#26414a' },
  { key: '--text', label: 'Text', fallback: '#e6f4f1' },
  { key: '--text-muted', label: 'Muted text', fallback: '#9ab5b5' },
  { key: '--positive', label: 'Positive', fallback: '#4fd1a5' },
  { key: '--negative', label: 'Negative', fallback: '#ff7a8a' },
];

export function SettingsPage() {
  const { user } = useAuth();
  const { settings, save, error, reload: reloadSettings } = useSettings();
  const health = useExcelQuery<DbHealth>('/api/health', undefined, { refreshInterval: 30_000 });

  const [currency, setCurrency] = useState(settings.currency);
  const [locale, setLocale] = useState(settings.locale);
  const [monthlyIncome, setMonthlyIncome] = useState(decimalToInput(settings.monthlyIncome));
  const [categoryText, setCategoryText] = useState(settings.categories.join(', '));
  const [saved, setSaved] = useState(false);

  const [displayCurrency, setDisplayCurrency] = useState(settings.displayCurrency);
  const [fxRate, setFxRate] = useState(decimalToInput(settings.fxRate));
  const [fxBusy, setFxBusy] = useState(false);
  const [fxMessage, setFxMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // Re-sync local form state whenever the stored settings change.
  useEffect(() => {
    setCurrency(settings.currency);
    setLocale(settings.locale);
    setMonthlyIncome(decimalToInput(settings.monthlyIncome));
    setCategoryText(settings.categories.join(', '));
    setDisplayCurrency(settings.displayCurrency);
    setFxRate(decimalToInput(settings.fxRate));
  }, [settings]);

  async function savePreferences(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    await save({
      currency: currency.toUpperCase(),
      locale,
      monthlyIncome: parseDecimal(monthlyIncome),
      categories: categoryText.split(',').map((c) => c.trim()).filter(Boolean),
    });
    setSaved(true);
  }

  async function saveConversion(event: FormEvent) {
    event.preventDefault();
    setFxMessage(null);
    const target = displayCurrency.trim().toUpperCase();
    const rate = parseDecimal(fxRate);

    if (target && target !== currency.toUpperCase() && rate <= 0) {
      setFxMessage({ tone: 'error', text: 'Enter an exchange rate above zero, or fetch one.' });
      return;
    }

    await save({ displayCurrency: target, fxRate: target ? rate || 1 : 1 });
    setFxMessage({
      tone: 'success',
      text: target && target !== currency.toUpperCase() ? `Amounts now display in ${target}.` : 'Conversion turned off.',
    });
  }

  async function lookUpRate() {
    setFxBusy(true);
    setFxMessage(null);
    try {
      const result = await fetchRate(currency, displayCurrency);
      setFxRate(String(result.rate));
      setFxMessage({
        tone: 'success',
        text: `1 ${currency.toUpperCase()} = ${result.rate} ${displayCurrency.toUpperCase()}${
          result.asOf ? ` (as of ${result.asOf})` : ''
        }. Press Save to keep it.`,
      });
    } catch (err) {
      setFxMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Rate lookup failed' });
    } finally {
      setFxBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setPasswordMessage({ tone: 'success', text: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not change password' });
    }
  }

  const customVars = settings.customVars ?? {};
  const activePreset = themePreset(settings.theme);

  return (
    <>
      <Card
        title="Appearance"
        subtitle="Themes are plain CSS variables on :root — saved to the Settings sheet."
      >
        {/* Grouped by scheme so a light theme is never a surprise, and capped
            in height so thirteen options do not push the rest of the page down. */}
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {(['light', 'dark'] as const).map((scheme) => (
            <fieldset key={scheme} className="theme-group">
              <legend className="section-label">{scheme === 'light' ? 'Light' : 'Dark'}</legend>
              <div className="theme-row">
                {THEME_PRESETS.filter((preset) => preset.scheme === scheme).map((preset) => {
                  const active = settings.theme === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={cx('theme-card', active && 'is-active')}
                      // The theme's own accent rides along: SettingsContext
                      // writes settings.accent inline as --accent, which would
                      // otherwise leave every palette wearing the old colour.
                      onClick={() => void save({ theme: preset.value, accent: preset.accent })}
                      title={preset.blurb}
                    >
                      <span
                        className="theme-card-preview"
                        style={{ background: preset.swatches[0], borderColor: preset.swatches[1] }}
                        aria-hidden="true"
                      >
                        <span className="theme-card-dot" style={{ background: preset.swatches[2] }} />
                        <span className="theme-card-surface" style={{ background: preset.swatches[1] }}>
                          <span className="theme-card-bar" style={{ background: preset.swatches[3] }} />
                          <span
                            className="theme-card-bar theme-card-bar--short"
                            style={{ background: preset.swatches[3] }}
                          />
                        </span>
                      </span>
                      <span className="theme-card-name">
                        <Icon icon={preset.icon} size="sm" />
                        {preset.label}
                      </span>
                      <span className="theme-card-blurb truncate">{preset.blurb}</span>
                      {active && (
                        <span className="theme-card-check" aria-hidden="true">
                          <Icon icon={Check} size="sm" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <Field
          label="Accent colour"
          className="span-2"
          hint="Applied on top of whichever theme is active. Picking a theme resets it to that theme's own accent."
        >
          <div className="swatches" style={{ marginTop: 4 }}>
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                className={cx('swatch', settings.accent === color && 'is-active')}
                style={{ background: color }}
                onClick={() => void save({ accent: color })}
                aria-label={`Accent ${color}`}
              />
            ))}
            <input
              type="color"
              className="control swatch"
              style={{ width: 44 }}
              value={settings.accent}
              onChange={(e) => void save({ accent: e.target.value })}
              aria-label="Custom accent colour"
            />
            <Button size="sm" variant="ghost" onClick={() => void save({ accent: activePreset.accent })}>
              <Icon icon={RotateCcw} size="sm" />
              Match theme
            </Button>
          </div>
        </Field>

        {settings.theme === 'custom' && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Custom palette</h3>
            <div className="form-grid">
              {CUSTOM_VARS.map((variable) => (
                <Field key={variable.key} label={variable.label} hint={variable.key}>
                  <input
                    type="color"
                    className="control"
                    value={customVars[variable.key] ?? variable.fallback}
                    onChange={(e) =>
                      void save({ customVars: { ...customVars, [variable.key]: e.target.value } })
                    }
                  />
                </Field>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <Button size="sm" onClick={() => void save({ customVars: {} })}>
                Reset custom palette
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </Card>

      <Card title="Preferences">
        <form className="form-grid" onSubmit={savePreferences}>
          <Field label="Currency" hint="What amounts are stored in. ISO code, e.g. USD, THB, EUR.">
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
          </Field>

          <Field label="Locale" hint="Controls number and date formatting.">
            <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {['en-US', 'en-GB', 'th-TH', 'de-DE', 'fr-FR', 'es-ES', 'id-ID', 'ja-JP', 'zh-CN'].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Monthly income"
            className="span-2"
            hint="Base for percentage budgets. Leave blank to use the income you actually record each month."
          >
            <DecimalInput value={monthlyIncome} onChange={setMonthlyIncome} placeholder="0.00" />
          </Field>

          <Field label="Categories" className="span-2" hint="Comma separated. Used by transactions and budgets.">
            <Input value={categoryText} onChange={(e) => setCategoryText(e.target.value)} />
          </Field>

          <div className="span-2 form-actions">
            {saved && <Badge tone="positive">Saved</Badge>}
            <Button type="submit" variant="primary">
              Save preferences
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Display in another currency"
        subtitle="Convert every amount on screen — e.g. keep books in USD but read them in Thai baht. Stored values never change, so you can switch back any time."
      >
        <form className="form-grid" onSubmit={saveConversion}>
          <Field label="Show amounts in" hint={`Leave blank to keep everything in ${currency.toUpperCase()}.`}>
            <Input
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value.toUpperCase())}
              placeholder={`${currency.toUpperCase()} (no conversion)`}
              maxLength={8}
            />
          </Field>

          <Field
            label={`Rate: 1 ${currency.toUpperCase()} = ? ${displayCurrency.toUpperCase() || currency.toUpperCase()}`}
            hint="Type it yourself, or fetch today's rate."
          >
            <DecimalInput value={fxRate} onChange={setFxRate} placeholder="1" />
          </Field>

          <div className="span-2 tag-row">
            {COMMON_CURRENCIES.map((option) => (
              <button
                key={option.code}
                type="button"
                className={cx('user-chip', displayCurrency === option.code && 'is-active')}
                onClick={() => setDisplayCurrency(option.code)}
              >
                {option.code} · {option.label}
              </button>
            ))}
            <button type="button" className="user-chip" onClick={() => setDisplayCurrency('')}>
              off
            </button>
          </div>

          {displayCurrency && displayCurrency !== currency.toUpperCase() && parseDecimal(fxRate) > 0 && (
            <div className="span-2">
              <Alert tone="info" title="Preview">
                {formatMoney(1000, currency, locale)} shows as{' '}
                <strong>{formatMoney(1000 * parseDecimal(fxRate), displayCurrency, locale)}</strong>
              </Alert>
            </div>
          )}

          {fxMessage && (
            <div className="span-2">
              <Alert tone={fxMessage.tone === 'success' ? 'success' : 'error'}>{fxMessage.text}</Alert>
            </div>
          )}

          {settings.fxRateUpdatedAt && (
            <div className="span-2 text-muted" style={{ fontSize: '0.82rem' }}>
              Saved rate last changed {formatDate(settings.fxRateUpdatedAt, locale)}. Rates are not refreshed
              automatically — the number you save is the number used.
            </div>
          )}

          <div className="span-2 form-actions">
            <Button
              onClick={() => void lookUpRate()}
              loading={fxBusy}
              disabled={!displayCurrency || displayCurrency === currency.toUpperCase()}
            >
              Fetch today's rate
            </Button>
            <Button type="submit" variant="primary">
              Save conversion
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Stock quotes">
        <p className="text-muted" style={{ fontSize: '0.87rem' }}>
          Provider: <strong>{providerName()}</strong>
          {hasLiveQuotes() ? ' · live quotes enabled' : ' · no API key, prices are simulated'}
        </p>
        <p className="text-muted" style={{ fontSize: '0.87rem', marginTop: 8 }}>
          Set <code>VITE_STOCK_API_PROVIDER</code> and <code>VITE_STOCK_API_KEY</code> in{' '}
          <code>frontend/.env.local</code>, then restart the dev server.
        </p>
        {settings.currency !== 'USD' && (
          <div style={{ marginTop: 12 }}>
            <Alert tone="warning" title={`Your books are in ${settings.currency}`}>
              Quotes come back in the market's own currency (USD for US tickers) and are compared directly
              against your stored cost basis. For accurate P&amp;L, keep the currency above as USD and use the
              display conversion below to read totals in {settings.displayCurrency || 'another currency'}.
            </Alert>
          </div>
        )}
      </Card>

      <Card
        title="Workbook"
        actions={
          <RefreshButton
            onRefresh={() => Promise.all([health.refresh(), reloadSettings()])}
            busy={health.isValidating}
            label="Refresh settings and workbook status"
          />
        }
      >
        {health.data ? (
          <div className="form-grid">
            <Field label="File">
              <Input value={health.data.dbPath} readOnly />
            </Field>
            <Field label="Last saved">
              <Input
                value={health.data.lastFlushAt ? formatDate(health.data.lastFlushAt, settings.locale) : 'not yet'}
                readOnly
              />
            </Field>
            <div className="span-2">
              {health.data.fileLocked ? (
                <Alert tone="warning" title="File is locked">
                  {health.data.hint}
                </Alert>
              ) : health.data.dirty ? (
                <Alert tone="info">Unsaved changes are queued — they write automatically.</Alert>
              ) : (
                <Alert tone="success">All changes are written to disk.</Alert>
              )}
            </div>
            <div className="span-2 text-muted" style={{ fontSize: '0.85rem' }}>
              {Object.entries(health.data.rowCounts)
                .map(([sheet, count]) => `${sheet}: ${count}`)
                .join(' · ')}
            </div>
            <div className="span-2 form-actions">
              <Button
                onClick={async () => {
                  await api.post('/api/flush');
                  await health.refresh();
                }}
              >
                Save workbook now
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted">Checking the backend…</p>
        )}
      </Card>

      <Card title="Account" subtitle={`Signed in as ${user?.displayName} (@${user?.username})`}>
        <form className="form-grid" onSubmit={changePassword}>
          <Field label="Current password">
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password" hint="At least 4 characters.">
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          {passwordMessage && (
            <div className="span-2">
              <Alert tone={passwordMessage.tone}>{passwordMessage.text}</Alert>
            </div>
          )}
          <div className="span-2 form-actions">
            <Button type="submit">Change password</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
