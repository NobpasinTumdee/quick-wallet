import {
  Calculator,
  ChevronDown,
  Download,
  FileText,
  Info,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { api } from '../api/client';
import { cx, formatDate, formatPercent } from '../lib/format';
import {
  AdditionalDeductions,
  CappedAllowance,
  EXPENSE_DEDUCTION_CAP,
  INSURANCE_CAP,
  SOCIAL_SECURITY_CAP,
  ThaiTaxResult,
  calculateThaiTax,
  defaultTaxRange,
  taxYearRange,
} from '../lib/thaiTaxEngine';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { useAuth } from '../state/AuthContext';
import { Transaction } from '../types';
import { Icon } from './Icon';
import { Alert, Button, DecimalInput, Field, Input, Modal, parseDecimal } from './ui';

/**
 * Thai personal income tax estimate.
 *
 * ---------------------------------------------------------------------------
 * THE LAZINESS IS THE POINT
 * ---------------------------------------------------------------------------
 * Nothing in this component runs until the user presses Run calculation.
 *
 * That is enforced structurally rather than by discipline. The transactions are
 * fetched with a bare `api.get`, not `useExcelDB` — so there is no cache
 * subscription, which means no fetch on mount, no refetch when the window
 * regains focus, and no participation in the invalidation that follows an
 * unrelated write. Opening the modal costs one render. Closing and reopening
 * costs nothing. The only way this calculation happens is a click.
 *
 * (`useExcelDB` with `enabled: false` would have been close, but a subscription
 * that is switched off is still a subscription someone can switch on by
 * accident later. A plain fetch cannot be woken up.)
 *
 * The range is fetched server-side — `from`/`to` are query params
 * `transactionsList_` already understands — so a five-year range does not pull
 * five years of rows through the client to throw most of them away.
 */

/** Clears a stale result whenever the inputs move. */
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: ThaiTaxResult }
  | { status: 'failed'; message: string };

/**
 * The optional inputs, as raw strings.
 *
 * Strings rather than numbers for the same reason every other form in this app
 * does it: a half-typed "9." must survive a re-render. They are parsed once,
 * when the calculation runs.
 */
type DeductionForm = Record<keyof AdditionalDeductions, string>;

const EMPTY_DEDUCTIONS: DeductionForm = {
  socialSecurity: '',
  insurance: '',
  funds: '',
  withholdingTax: '',
};

function toDeductions(form: DeductionForm): AdditionalDeductions {
  return {
    socialSecurity: parseDecimal(form.socialSecurity),
    insurance: parseDecimal(form.insurance),
    funds: parseDecimal(form.funds),
    withholdingTax: parseDecimal(form.withholdingTax),
  };
}

export function TaxCalculatorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { user } = useAuth();
  const money = useMoneyFormatter();

  const [range, setRange] = useState(() => defaultTaxRange());
  const [deductions, setDeductions] = useState<DeductionForm>(EMPTY_DEDUCTIONS);
  const [deductionsOpen, setDeductionsOpen] = useState(false);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [exporting, setExporting] = useState(false);

  /** Aborts an in-flight fetch when the sheet closes mid-request. */
  const abort = useRef<AbortController | null>(null);

  /* Reset on open so a result from a previous session can never be read as
     belonging to the range now on screen. */
  useEffect(() => {
    if (!open) {
      abort.current?.abort();
      return;
    }
    setRange(defaultTaxRange());
    setDeductions(EMPTY_DEDUCTIONS);
    setDeductionsOpen(false);
    setRun({ status: 'idle' });
  }, [open]);

  useEffect(() => () => abort.current?.abort(), []);

  /** Any input change invalidates the answer — never show one set of figures
   *  under another set's labels. */
  function invalidate() {
    setRun((current) => (current.status === 'done' ? { status: 'idle' } : current));
  }

  function patchRange(patch: Partial<typeof range>) {
    setRange((current) => ({ ...current, ...patch }));
    invalidate();
  }

  function patchDeduction(key: keyof DeductionForm, value: string) {
    setDeductions((current) => ({ ...current, [key]: value }));
    invalidate();
  }

  const currency = (settings.currency || 'THB').toUpperCase();
  const wrongCurrency = currency !== 'THB';
  const invalidRange = Boolean(range.from && range.to && range.from > range.to);
  const enteredCount = Object.values(deductions).filter((value) => parseDecimal(value) > 0).length;

  async function calculate() {
    if (invalidRange) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setRun({ status: 'running' });

    try {
      const rows = await api.get<Transaction[]>(
        '/api/transactions',
        // The server caps at 5000; a year of personal transactions is nowhere
        // near it, and asking for the ceiling avoids a silently truncated total.
        { from: range.from, to: range.to, limit: 5000 },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setRun({
        status: 'done',
        result: calculateThaiTax(rows ?? [], range.from, range.to, toDeductions(deductions)),
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setRun({
        status: 'failed',
        message: error instanceof Error ? error.message : t('tax.loadFailed'),
      });
    }
  }

  async function download(result: ThaiTaxResult) {
    setExporting(true);
    try {
      const { exportTaxPdf } = await import('../lib/taxPdf');
      await exportTaxPdf({ result, currency, taxpayerName: user?.displayName });
    } catch (error) {
      setRun({
        status: 'failed',
        message: error instanceof Error ? error.message : t('tax.pdfFailed'),
      });
    } finally {
      setExporting(false);
    }
  }

  const result = run.status === 'done' ? run.result : null;
  const thisYear = new Date().getFullYear();

  /** One optional-allowance line. Rendered only when something was claimed —
   *  a row of zeroes says nothing except that the field exists. */
  const allowanceLine = (
    label: string,
    thai: string,
    allowance: CappedAllowance,
    hint?: string,
  ) =>
    allowance.applied > 0 && (
      <div className="tax-line">
        <span className="tax-line-label">
          {t('tax.lessLabel', { label })}
          <em>
            {thai}
            {allowance.capped
              ? t('tax.allowanceCapped', {
                  requested: money.formatBase(allowance.requested),
                  cap: money.formatBase(allowance.cap ?? 0),
                })
              : hint && t('tax.allowanceHintSuffix', { hint })}
          </em>
        </span>
        <span className="tax-line-value tax-line-value--minus">
          −{money.formatBase(allowance.applied)}
        </span>
      </div>
    );

  return (
    <Modal
      open={open}
      title={
        <span className="tax-title">
          <Icon icon={FileText} size="sm" />
          {t('tax.estimateHeading')}
        </span>
      }
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          {result && (
            <Button onClick={() => void download(result)} loading={exporting}>
              <Icon icon={Download} size="sm" />
              {t('tax.exportPdf')}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void calculate()}
            loading={run.status === 'running'}
            disabled={invalidRange}
          >
            <Icon icon={Calculator} size="sm" />
            {t(result ? 'tax.recalculate' : 'tax.runCalculation')}
          </Button>
        </>
      }
    >
      {/* ---- Range ---- */}
      <div className="tax-range">
        <Field label={t('tax.from')}>
          <Input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(event) => patchRange({ from: event.target.value })}
          />
        </Field>
        <Field label={t('tax.to')}>
          <Input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(event) => patchRange({ to: event.target.value })}
          />
        </Field>
        <div className="tax-range-presets">
          <button type="button" className="user-chip" onClick={() => patchRange(defaultTaxRange())}>
            {thisYear} to date
          </button>
          <button
            type="button"
            className="user-chip"
            onClick={() => patchRange(taxYearRange(thisYear - 1))}
          >
            {thisYear - 1} full year
          </button>
        </div>
      </div>

      {/* ---- Optional allowances ----
          Collapsed by default: the four statutory steps are the calculation,
          and these are refinements. Opening it is a deliberate act, and the
          count in the header means a closed panel never hides a figure that is
          silently changing the answer. */}
      <div className={cx('tax-deductions', deductionsOpen && 'is-open')}>
        <button
          type="button"
          className="tax-deductions-toggle"
          aria-expanded={deductionsOpen}
          onClick={() => setDeductionsOpen((current) => !current)}
        >
          <span>{t('tax.additionalDeductions')}</span>
          <span className="tax-deductions-state">
            {enteredCount > 0 ? t('tax.entered', { count: enteredCount }) : t('common.optional')}
          </span>
          <Icon
            icon={ChevronDown}
            size="sm"
            className={cx('tax-deductions-caret', deductionsOpen && 'is-open')}
          />
        </button>

        {deductionsOpen && (
          <div className="tax-deductions-body">
            <Field
              label={t('tax.socialSecurity')}
              hint={t('tax.socialSecurityHint', { amount: money.formatBase(SOCIAL_SECURITY_CAP) })}
            >
              <DecimalInput
                value={deductions.socialSecurity}
                onChange={(raw) => patchDeduction('socialSecurity', raw)}
                placeholder="0.00"
              />
            </Field>

            <Field
              label={t('tax.lifeHealthInsurance')}
              hint={t('tax.insuranceHint', { amount: money.formatBase(INSURANCE_CAP) })}
            >
              <DecimalInput
                value={deductions.insurance}
                onChange={(raw) => patchDeduction('insurance', raw)}
                placeholder="0.00"
              />
            </Field>

            <Field
              label={t('tax.investmentFunds')}
              hint={t('tax.fundsHint')}
            >
              <DecimalInput
                value={deductions.funds}
                onChange={(raw) => patchDeduction('funds', raw)}
                placeholder="0.00"
              />
            </Field>

            <Field
              label={t('tax.withholding')}
              hint={t('tax.withholdingHint')}
            >
              <DecimalInput
                value={deductions.withholdingTax}
                onChange={(raw) => patchDeduction('withholdingTax', raw)}
                placeholder="0.00"
              />
            </Field>
          </div>
        )}
      </div>

      {invalidRange && <Alert tone="error">{t('tax.dateRangeError')}</Alert>}

      {wrongCurrency && (
        <Alert tone="warning" title={t('tax.wrongCurrencyTitle', { currency })}>
          {t('tax.wrongCurrencyBody', { currency })}
        </Alert>
      )}

      {run.status === 'failed' && <Alert tone="error">{run.message}</Alert>}

      {/* ---- Before the first run ---- */}
      {run.status === 'idle' && (
        <div className="tax-idle">
          <Icon icon={Calculator} size="xl" />
          <p>
            {/* `Trans` because the button's name is emphasised mid-sentence, and
                where that emphasis falls moves between languages. */}
            <Trans
              i18nKey="tax.idleBody"
              values={{ action: t('tax.runCalculation') }}
              components={{ 1: <strong /> }}
            />
          </p>
        </div>
      )}

      {run.status === 'running' && (
        <div className="tax-idle">
          <p>{t('tax.readingTransactions')}</p>
        </div>
      )}

      {/* ---- The receipt ---- */}
      {result && (
        <div className="tax-receipt">
          <header className="tax-receipt-head">
            <div>
              <span className="section-label">
                {result.withholdingTax > 0
                  ? result.isRefund
                    ? t('tax.refundDue')
                    : t('tax.stillToPay')
                  : t('tax.estimatedPayable')}
              </span>
              <div className={cx('tax-total', result.isRefund && 'text-positive')}>
                {money.formatBase(
                  result.withholdingTax > 0
                    ? result.isRefund
                      ? result.refundAmount
                      : result.amountOwed
                    : result.taxPayable,
                )}
              </div>
            </div>
            <div className="tax-receipt-meta">
              <span>
                {formatDate(result.from, settings.locale)} → {formatDate(result.to, settings.locale)}
              </span>
              <span>
                {result.transactionCount} income record{result.transactionCount === 1 ? '' : 's'}
              </span>
            </div>
          </header>

          {result.transactionCount === 0 && (
            <Alert tone="info" title={t('tax.noIncomeInRange')}>
              {t('tax.noIncomeBody')}
            </Alert>
          )}

          {/* ---- Steps 1–4 ---- */}
          <section className="tax-block">
            <h3 className="tax-block-title">{t('tax.howTaxableReached')}</h3>

            <div className="tax-line">
              <span className="tax-line-label">
                {t('tax.grossIncome')}
                <em>{t('tax.grossIncomeSub')}</em>
              </span>
              <span className="tax-line-value">{money.formatBase(result.grossIncome)}</span>
            </div>

            <div className="tax-line">
              <span className="tax-line-label">
                {t('tax.expenseDeduction')}
                <em>
                  {t('tax.expenseDeductionSub', { amount: money.formatBase(EXPENSE_DEDUCTION_CAP) })}
                  {result.expenseDeductionCapped &&
                    t('tax.expenseDeductionCapped', {
                      amount: money.formatBase(result.expenseDeductionUncapped),
                    })}
                </em>
              </span>
              <span className="tax-line-value tax-line-value--minus">
                −{money.formatBase(result.expenseDeduction)}
              </span>
            </div>

            <div className="tax-line">
              <span className="tax-line-label">
                {t('tax.personalAllowance')}
                <em>{t('tax.personalAllowanceSub')}</em>
              </span>
              <span className="tax-line-value tax-line-value--minus">
                −{money.formatBase(result.allowances.personal)}
              </span>
            </div>

            {allowanceLine(t('tax.allowanceSocialSecurity'), 'ประกันสังคม', result.allowances.socialSecurity)}
            {allowanceLine(
              t('tax.allowanceInsurance'),
              'ประกันชีวิตและสุขภาพ',
              result.allowances.insurance,
            )}
            {allowanceLine(
              t('tax.allowanceFunds'),
              'กองทุนรวม SSF / RMF / Thai ESG',
              result.allowances.funds,
              t('tax.allowanceFundsHint'),
            )}

            <div className="tax-line tax-line--net">
              <span className="tax-line-label">
                {t('tax.netTaxableIncome')}
                <em>{t('tax.netTaxableIncomeSub')}</em>
              </span>
              <span className="tax-line-value">{money.formatBase(result.netTaxableIncome)}</span>
            </div>
          </section>

          {/* ---- The ladder ---- */}
          <section className="tax-block">
            <h3 className="tax-block-title">
              {t('tax.progressiveBands')}
              <span className="tax-block-note">
                <Icon icon={Info} size="sm" />
                {t('tax.bandLadderHint')}
              </span>
            </h3>

            <div className="table-wrap">
              <table className="data data--nested tax-bands">
                <thead>
                  <tr>
                    <th>{t('tax.band')}</th>
                    <th className="num">{t('tax.rate')}</th>
                    <th className="num">{t('tax.taxableHere')}</th>
                    <th className="num">{t('tax.taxColumn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.brackets.map((bracket) => (
                    <tr
                      key={bracket.step}
                      /* Unreached bands stay visible but recede — seeing the
                         whole ladder is what makes a marginal system legible. */
                      className={cx(
                        !bracket.reached && 'is-dim',
                        bracket.isMarginal && 'is-marginal',
                      )}
                    >
                      <td>
                        {bracket.upTo === Infinity
                          ? t('tax.bandOver', { from: bracket.from.toLocaleString() })
                          : t('tax.bandRange', {
                              from: (bracket.from === 0 ? 0 : bracket.from + 1).toLocaleString(),
                              to: bracket.upTo.toLocaleString(),
                            })}
                        {bracket.isMarginal && <span className="tax-marginal">{t('tax.yourRate')}</span>}
                      </td>
                      <td className="num">{(bracket.rate * 100).toFixed(0)}%</td>
                      <td className="num">
                        {bracket.reached ? (
                          bracket.taxableInBand.toLocaleString()
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="num">
                        {bracket.reached ? (
                          <strong>{money.formatBase(bracket.tax)}</strong>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---- The answer, and what it means month to month ---- */}
          <section className="tax-summary">
            <div className="tax-summary-figure">
              <span className="section-label">{t('tax.taxPayable')}</span>
              <strong>{money.formatBase(result.taxPayable)}</strong>
            </div>

            {/* Settlement. Only shown when there is something to settle against —
                otherwise "less: ฿0 withheld" is a line that answers nothing. */}
            {result.withholdingTax > 0 && (
              <div className="tax-settle">
                <div className="tax-settle-row">
                  <span>
                    {t('tax.lessWithholding')}
                    <em>ภาษีหัก ณ ที่จ่าย</em>
                  </span>
                  <span className="tax-line-value tax-line-value--minus">
                    −{money.formatBase(result.withholdingTax)}
                  </span>
                </div>

                <div className={cx('tax-settle-total', result.isRefund && 'is-refund')}>
                  <span>
                    {t(result.isRefund ? 'tax.refundDue' : 'tax.stillToPay')}
                    <em>{result.isRefund ? 'เงินภาษีที่ได้คืน' : 'ภาษีที่ต้องชำระเพิ่ม'}</em>
                  </span>
                  <strong>
                    {money.formatBase(result.isRefund ? result.refundAmount : result.amountOwed)}
                  </strong>
                </div>
              </div>
            )}

            <div className="tax-summary-stats">
              <div>
                <span className="section-label">{t('tax.effectiveRate')}</span>
                <strong>{formatPercent(result.effectiveRate, 2)}</strong>
              </div>
              <div>
                <span className="section-label">{t('tax.marginalRate')}</span>
                <strong>{formatPercent(result.marginalRate, 0)}</strong>
              </div>
              <div>
                <span className="section-label">{t('tax.perMonth')}</span>
                <strong>{money.formatBase(result.monthlyEquivalent)}</strong>
              </div>
              <div>
                <span className="section-label">{t('tax.afterTax')}</span>
                <strong>{money.formatBase(result.netAfterTax)}</strong>
              </div>
            </div>
          </section>

          {/* ---- The part that makes the number honest ----
              Comes from the result, so it names only the caveats that actually
              apply to these figures. */}
          <section className="tax-assumptions">
            <h3 className="tax-block-title">
              <Icon icon={TriangleAlert} size="sm" />
              {t('tax.assumptionsHeading')}
            </h3>
            <ul>
              {result.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}
