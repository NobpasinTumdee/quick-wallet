import { Check, ScanLine, ShieldCheck, Upload, X } from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAX_RECEIPT_LABEL,
  ReceiptScan,
  ScanStage,
  useReceiptScanner,
} from '../hooks/useReceiptScanner';
import { cx, formatDate } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Icon } from './Icon';
import { Button } from './ui';

/**
 * Drop a slip, get the fields filled in — read on this device.
 *
 * ---------------------------------------------------------------------------
 * WHY IT SHOWS WHAT IT FOUND INSTEAD OF JUST FILLING THE FORM
 * ---------------------------------------------------------------------------
 * OCR is confidently wrong often enough that silently overwriting three inputs
 * is hostile: the user did not watch it happen, and a misread 1,290 as 129 is
 * invisible once it sits in a field they believe they typed. So the scan reports
 * its findings as chips, and the values stay editable.
 *
 * ---------------------------------------------------------------------------
 * THE SWEEP AND THE BAR DO DIFFERENT JOBS
 * ---------------------------------------------------------------------------
 * The laser says *something is happening*; the bar says *how much is left*.
 * Both are needed here because the first run downloads several megabytes of
 * language model and can take ten seconds — long enough that an indeterminate
 * animation alone reads as a hang.
 */

const STAGE_KEYS: Record<ScanStage, 'receipt.stagePreparing' | 'receipt.stageLoading' | 'receipt.stageReading'> =
  {
    preparing: 'receipt.stagePreparing',
    loading: 'receipt.stageLoading',
    reading: 'receipt.stageReading',
  };

export function ReceiptScanner({
  onFilled,
  disabled,
}: {
  /** Called with whatever the scan could read. */
  onFilled: (scan: ReceiptScan) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();

  const scanner = useReceiptScanner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file || disabled) return;
    const parsed = await scanner.scan(file);
    if (parsed) onFilled(parsed);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  const scanning = scanner.phase === 'scanning';

  /** Nothing parsed, but text came back — offer it rather than discard it. */
  const salvage = scanner.text?.split('\n')[0]?.slice(0, 60).trim();

  return (
    <div className="scan">
      {scanner.phase === 'idle' ? (
        <div
          className={cx('scan-drop', dragging && 'is-dragging', disabled && 'is-disabled')}
          /* preventDefault on dragOver is what stops the browser navigating to
             the dropped image instead of handing it to us. */
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon icon={ScanLine} size="lg" />
          <div className="scan-drop-copy">
            <strong>{t('receipt.scan')}</strong>
            <span>{dragging ? t('receipt.dropHere') : t('receipt.scanHint')}</span>
          </div>
          <Button size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
            <Icon icon={Upload} size="sm" />
            {t('receipt.chooseFile')}
          </Button>
        </div>
      ) : (
        <div className="scan-result">
          {scanner.preview && (
            <div className={cx('scan-frame', scanning && 'is-scanning')}>
              <img src={scanner.preview} alt={scanner.fileName ?? ''} />
              {scanning && <span className="scan-laser" aria-hidden="true" />}
            </div>
          )}

          <div className="scan-body">
            {scanning && (
              <>
                <strong className="scan-status">{t(STAGE_KEYS[scanner.stage])}</strong>

                <div
                  className="scan-progress"
                  role="progressbar"
                  aria-valuenow={scanner.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t(STAGE_KEYS[scanner.stage])}
                >
                  <span
                    className="scan-progress-fill"
                    style={{ width: `${scanner.progress}%` }}
                  />
                </div>

                <span className="scan-sub">
                  {scanner.progress}% ·{' '}
                  {scanner.stage === 'loading' ? t('receipt.firstRunHint') : t('receipt.scanningHint')}
                </span>
              </>
            )}

            {scanner.phase === 'done' && scanner.result && (
              <>
                <strong className="scan-status scan-status--ok">
                  <Icon icon={Check} size="sm" />
                  {t('receipt.filled')}
                </strong>
                <div className="scan-found">
                  {scanner.result.amount !== undefined && (
                    <span className="scan-chip">
                      <em>{t('receipt.foundAmount')}</em>
                      {money(scanner.result.amount)}
                    </span>
                  )}
                  {scanner.result.date && (
                    <span className="scan-chip">
                      <em>{t('receipt.foundDate')}</em>
                      {formatDate(scanner.result.date, settings.locale)}
                    </span>
                  )}
                  {scanner.result.note && (
                    <span className="scan-chip">
                      <em>{t('receipt.foundNote')}</em>
                      {scanner.result.note}
                    </span>
                  )}
                </div>
              </>
            )}

            {scanner.phase === 'failed' && (
              <>
                <strong className="scan-status scan-status--bad">
                  {t(
                    scanner.error?.code === 'nothingFound'
                      ? 'receipt.nothingFound'
                      : scanner.error?.code === 'tooLarge'
                        ? 'receipt.tooLarge'
                        : scanner.error?.code === 'wrongType'
                          ? 'receipt.wrongType'
                          : 'receipt.failed',
                    { limit: MAX_RECEIPT_LABEL },
                  )}
                </strong>
                <span className="scan-sub">{t('receipt.nothingFoundHint')}</span>

                {/* It read *something*, just nothing structured. Offering the
                    first line beats throwing the whole scan away. */}
                {salvage && (
                  <div className="scan-salvage">
                    <span className="scan-sub">{t('receipt.rawText')}</span>
                    <code>{salvage}</code>
                    <Button size="sm" variant="ghost" onClick={() => onFilled({ note: salvage })}>
                      {t('receipt.useAnyway')}
                    </Button>
                  </div>
                )}
              </>
            )}

            {!scanning && (
              <div className="scan-actions">
                <Button size="sm" variant="ghost" onClick={scanner.reset}>
                  <Icon icon={X} size="sm" />
                  {scanner.phase === 'failed' ? t('receipt.retry') : t('receipt.remove')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* The reason this feature is worth having at all, said out loud. */}
      <p className="scan-disclaimer">
        <Icon icon={ShieldCheck} size="sm" />
        {t('receipt.onDevice')}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          // Lets the same file be chosen twice in a row after a reset.
          event.target.value = '';
        }}
      />
    </div>
  );
}
