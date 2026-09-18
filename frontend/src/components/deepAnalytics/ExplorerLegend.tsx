import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { OTHER, Series } from '../../lib/explorerData';
import { contrastRatio } from '../../lib/explorerPalette';

/**
 * The legend, where each swatch is also a colour picker.
 *
 * ---------------------------------------------------------------------------
 * WHY A NATIVE <input type="color">
 * ---------------------------------------------------------------------------
 * A custom popover would mean building a colour picker — hue/saturation
 * plane, hex field, keyboard handling, focus trap — to reach something every
 * browser and both mobile OSes already ship, and ship accessibly. The input is
 * laid invisibly over the swatch, so clicking the swatch *is* clicking the
 * input: the swatch is what you see, the OS picker is what opens, and the input
 * remains focusable for a keyboard.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WARNS BUT NEVER REFUSES
 * ---------------------------------------------------------------------------
 * The default palette is validated; a hand-picked colour cannot be. A colour
 * under 3:1 against the chart surface gets a warning in place, saying that the
 * values are still readable in the Chart data table — which is the relief the
 * palette validator requires for low-contrast marks. It is not blocked: it is
 * the user's chart, and a pale colour on purpose is a legitimate choice.
 *
 * "Other" has no picker. It is a bucket, not a category, and giving it a hue
 * would make it read as a ninth series.
 */
export function ExplorerLegend({
  series,
  colorOf,
  labelOf,
  customized,
  surface,
  onColor,
  onReset,
  onResetAll,
}: {
  series: Series[];
  colorOf: (series: Series) => string;
  labelOf: (key: string) => string;
  /** Series keys the user has recoloured. */
  customized: ReadonlySet<string>;
  /** The painted chart surface, for the contrast warning. */
  surface: string;
  onColor: (key: string, color: string) => void;
  onReset: (key: string) => void;
  onResetAll: () => void;
}) {
  const { t } = useTranslation();
  if (series.length === 0) return null;

  return (
    <div className="xp-legend-panel">
      <ul className="xp-legend">
        {series.map((s) => {
          const color = colorOf(s);
          const label = labelOf(s.key);
          const isOther = s.key === OTHER;
          const ratio = contrastRatio(color, surface);
          const low = customized.has(s.key) && ratio !== null && ratio < 3;

          return (
            <li key={s.key} className={isOther ? 'is-other' : undefined}>
              {isOther ? (
                <span className="xp-legend-swatch" style={{ background: color }} aria-hidden="true" />
              ) : (
                <label className="xp-legend-swatch is-editable" style={{ background: color }}>
                  <span className="sr-only">{t('explorer.changeColor', { name: label })}</span>
                  <input
                    type="color"
                    /* A native colour input only accepts #rrggbb. */
                    value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
                    onChange={(event) => onColor(s.key, event.target.value)}
                  />
                </label>
              )}
              <span className="xp-legend-label">{label}</span>

              {low && (
                <span className="xp-legend-warn" title={t('explorer.lowContrast')}>
                  <Icon icon={AlertTriangle} size="sm" />
                  <span className="sr-only">{t('explorer.lowContrast')}</span>
                </span>
              )}

              {customized.has(s.key) && (
                <button
                  type="button"
                  className="xp-legend-reset"
                  onClick={() => onReset(s.key)}
                  aria-label={t('explorer.resetColorFor', { name: label })}
                  title={t('explorer.resetColor')}
                >
                  <Icon icon={RotateCcw} size="sm" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {customized.size > 0 && (
        <button type="button" className="xp-link-button" onClick={onResetAll}>
          {t('explorer.resetAllColors')}
        </button>
      )}
    </div>
  );
}
