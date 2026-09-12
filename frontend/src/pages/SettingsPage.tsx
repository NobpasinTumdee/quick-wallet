import { FormEvent, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { api } from '../api/client';
import { ThemeSettings } from '../components/ThemeSettings';
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
import { COMMON_CURRENCIES, fetchRate } from '../services/fxApi';
import { hasLiveQuotes, providerName } from '../services/stockApi';
import { LanguageSelector } from '../components/LanguageSelector';
import { useAuth } from '../state/AuthContext';
import { useSettings } from '../state/SettingsContext';
import { DbHealth } from '../types';

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { settings, save, reload: reloadSettings } = useSettings();
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
      setFxMessage({ tone: 'error', text: t('settings.rateAboveZero') });
      return;
    }

    await save({ displayCurrency: target, fxRate: target ? rate || 1 : 1 });
    setFxMessage({
      tone: 'success',
      text:
        target && target !== currency.toUpperCase()
          ? t('settings.amountsNowIn', { currency: target })
          : t('settings.conversionOff'),
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
        text: t('settings.rateFetched', {
          from: currency.toUpperCase(),
          rate: result.rate,
          to: displayCurrency.toUpperCase(),
          asOf: result.asOf ? t('settings.rateAsOf', { date: result.asOf }) : '',
        }),
      });
    } catch (err) {
      setFxMessage({ tone: 'error', text: err instanceof Error ? err.message : t('settings.rateLookupFailed') });
    } finally {
      setFxBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMessage(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      setPasswordMessage({ tone: 'success', text: t('settings.passwordUpdated') });
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPasswordMessage({ tone: 'error', text: err instanceof Error ? err.message : t('settings.passwordChangeFailed') });
    }
  }

  return (
    <>
      <ThemeSettings />

      <Card title={t('settings.preferences')}>
        <form className="form-grid" onSubmit={savePreferences}>
          <Field label={t('settings.currency')} hint={t('settings.currencyHint')}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={8} />
          </Field>

          {/* First in the card, and outside the form: it applies immediately
              rather than waiting for "Save preferences". A control whose whole
              job is to change what you are looking at should not need a second
              click to take effect — and it persists itself, through
              `useLanguage`, which also keeps the Locale field below in step. */}
          <LanguageSelector className="span-2" />

          <Field label={t('settings.locale')} hint={t('settings.localeHint')}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {['en-US', 'en-GB', 'th-TH', 'de-DE', 'fr-FR', 'es-ES', 'id-ID', 'ja-JP', 'zh-CN'].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t('settings.monthlyIncome')}
            className="span-2"
            hint={t('settings.monthlyIncomeHint')}
          >
            <DecimalInput value={monthlyIncome} onChange={setMonthlyIncome} placeholder="0.00" />
          </Field>

          <Field label={t('settings.categories')} className="span-2" hint={t('settings.categoriesHint')}>
            <Input value={categoryText} onChange={(e) => setCategoryText(e.target.value)} />
          </Field>

          <div className="span-2 form-actions">
            {saved && <Badge tone="positive">{t('common.saved')}</Badge>}
            <Button type="submit" variant="primary">
              {t('settings.savePreferences')}
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title={t('settings.conversionTitle')}
        subtitle={t('settings.conversionSubtitle')}
      >
        <form className="form-grid" onSubmit={saveConversion}>
          <Field label={t('settings.showAmountsIn')} hint={t('settings.keepEverythingIn', { currency: currency.toUpperCase() })}>
            <Input
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value.toUpperCase())}
              placeholder={t('settings.noConversion', { currency: currency.toUpperCase() })}
              maxLength={8}
            />
          </Field>

          <Field
            label={t('settings.rateLabel', { from: currency.toUpperCase(), to: displayCurrency.toUpperCase() || currency.toUpperCase() })}
            hint={t('settings.rateHint')}
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
              <Alert tone="info" title={t('settings.preview')}>
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
              {t('settings.fetchRate')}
            </Button>
            <Button type="submit" variant="primary">
              {t('settings.saveConversion')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('settings.quotesTitle')}>
        <p className="text-muted" style={{ fontSize: '0.87rem' }}>
          {t('settings.providerLabel')} <strong>{providerName()}</strong>
          {t(hasLiveQuotes() ? 'settings.liveQuotesOn' : 'settings.liveQuotesOff')}
        </p>
        <p className="text-muted" style={{ fontSize: '0.87rem', marginTop: 8 }}>
          {/* `Trans` keeps the three <code> spans as components the translator
              can reposition — the variable *names* stay untranslated inside. */}
          <Trans
            i18nKey="settings.envHint"
            values={{
              provider: 'VITE_STOCK_API_PROVIDER',
              key: 'VITE_STOCK_API_KEY',
              file: 'frontend/.env.local',
            }}
            components={{ 1: <code />, 3: <code />, 5: <code /> }}
          />
        </p>
        {settings.currency !== 'USD' && (
          <div style={{ marginTop: 12 }}>
            <Alert tone="warning" title={t('settings.booksAreIn', { currency: settings.currency })}>
              {t('settings.quotesCurrencyWarning', {
                currency: settings.displayCurrency || t('settings.anotherCurrency'),
              })}
            </Alert>
          </div>
        )}
      </Card>

      <Card
        title={t('settings.workbookTitle')}
        actions={
          <RefreshButton
            onRefresh={() => Promise.all([health.refresh(), reloadSettings()])}
            busy={health.isValidating}
            label={t('settings.refreshWorkbook')}
          />
        }
      >
        {health.data ? (
          <div className="form-grid">
            <Field label={t('settings.file')}>
              <Input value={health.data.dbPath} readOnly />
            </Field>
            <Field label={t('settings.lastSaved')}>
              <Input
                value={health.data.lastFlushAt ? formatDate(health.data.lastFlushAt, settings.locale) : 'not yet'}
                readOnly
              />
            </Field>
            <div className="span-2">
              {health.data.fileLocked ? (
                <Alert tone="warning" title={t('settings.fileLocked')}>
                  {health.data.hint}
                </Alert>
              ) : health.data.dirty ? (
                <Alert tone="info">{t('settings.queuedWrites')}</Alert>
              ) : (
                <Alert tone="success">{t('settings.allWritten')}</Alert>
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
                {t('settings.saveWorkbook')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted">{t('settings.checkingBackend')}</p>
        )}
      </Card>

      <Card
        title={t('settings.account')}
        subtitle={t('settings.signedInAs', { name: user?.displayName ?? '', username: user?.username ?? '' })}
      >
        <form className="form-grid" onSubmit={changePassword}>
          <Field label={t('settings.currentPassword')}>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label={t('settings.newPassword')} hint={t('settings.passwordHint')}>
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
            <Button type="submit">{t('settings.changePassword')}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
