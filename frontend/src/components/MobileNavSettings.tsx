import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { NAV_LABELS } from '../lib/navLabels';
import {
  ARC_SLOTS,
  DEFAULT_MOBILE_NAV,
  MobileNavConfig,
  addArcSlot,
  assignSlot,
  isDefaultMobileNav,
  removeArcSlot,
  resolveMobileNav,
} from '../lib/mobileNav';
import { Route } from '../lib/router';
import { Button, Card, Select } from './ui';

/**
 * Rearranging the phone's navigation.
 *
 * ---------------------------------------------------------------------------
 * WHY DROPDOWNS AND NOT DRAG AND DROP
 * ---------------------------------------------------------------------------
 * Dragging is the obvious interaction and the wrong one here. It needs a
 * library (this app has none for it), it is awkward on the touch screen this
 * very setting is about, and it is close to unusable with a keyboard or a
 * screen reader — for a control whose entire job is deciding how someone
 * navigates. A `<select>` per slot is boring, works everywhere, and on a phone
 * opens the OS picker.
 *
 * Reordering within the arc still wants to be direct, so those get up/down
 * buttons: position matters there (the arc runs left to right, and the far end
 * sits under the thumb) in a way it does not for the bar's fixed four.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY EDIT GOES THROUGH THE RESOLVER
 * ---------------------------------------------------------------------------
 * Nothing here writes a raw array. `assignSlot` swaps rather than overwrites,
 * so picking a screen that is already somewhere else cannot silently drop the
 * one it displaced — and `resolveMobileNav` runs on the result, which is what
 * guarantees the directory stays reachable however the user arranges things.
 * The rules live in one tested module rather than in this component's handlers.
 */
export function MobileNavSettings({
  value,
  onChange,
  busy,
}: {
  value: MobileNavConfig;
  onChange: (next: MobileNavConfig) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const config = useMemo(() => resolveMobileNav(value), [value]);
  const [adding, setAdding] = useState<Route | ''>('');

  const isDefault = isDefaultMobileNav(config);
  const placed = new Set<Route>([...config.tabs, ...config.arc]);
  const spare = NAV_LABELS.filter((entry) => !placed.has(entry.route));

  const label = (route: Route) => {
    const entry = NAV_LABELS.find((item) => item.route === route);
    return entry ? t(entry.labelKey) : route;
  };

  /** Every route, so a slot can be set to anything — swapping handles the rest. */
  const options = NAV_LABELS.map((entry) => (
    <option key={entry.route} value={entry.route}>
      {t(entry.labelKey)}
    </option>
  ));

  function move(index: number, delta: number) {
    const next = [...config.arc];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(resolveMobileNav({ tabs: config.tabs, arc: next }));
  }

  return (
    <Card
      title={t('mobileNav.title')}
      subtitle={t('mobileNav.subtitle')}
      actions={
        !isDefault && (
          <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_MOBILE_NAV)} disabled={busy}>
            <Icon icon={RotateCcw} size="sm" />
            {t('mobileNav.reset')}
          </Button>
        )
      }
    >
      <div className="navcfg">
        {/* ---- The bar ---- */}
        <section className="navcfg-group">
          <header className="navcfg-head">
            <h3>{t('mobileNav.barTitle')}</h3>
            <p>{t('mobileNav.barHint')}</p>
          </header>

          <div className="navcfg-slots">
            {config.tabs.map((route, index) => (
              <label key={index} className="navcfg-slot">
                <span className="navcfg-slot-index">{index + 1}</span>
                <Select
                  value={route}
                  disabled={busy}
                  aria-label={t('mobileNav.slotLabel', { index: index + 1 })}
                  onChange={(event) =>
                    onChange(assignSlot(config, 'tabs', index, event.target.value as Route))
                  }
                >
                  {options}
                </Select>
              </label>
            ))}
          </div>
          {/* The centre button is not a slot — it opens the arc below. Said
              here because the bar visibly has five positions, not four. */}
          <p className="navcfg-note">{t('mobileNav.centreNote')}</p>
        </section>

        {/* ---- The arc ---- */}
        <section className="navcfg-group">
          <header className="navcfg-head">
            <h3>{t('mobileNav.arcTitle')}</h3>
            <p>{t('mobileNav.arcHint', { max: ARC_SLOTS })}</p>
          </header>

          <ul className="navcfg-arc">
            {config.arc.map((route, index) => (
              <li key={route} className="navcfg-arc-row">
                <span className="navcfg-slot-index">{index + 1}</span>
                <Select
                  value={route}
                  disabled={busy}
                  aria-label={t('mobileNav.slotLabel', { index: index + 1 })}
                  onChange={(event) =>
                    onChange(assignSlot(config, 'arc', index, event.target.value as Route))
                  }
                >
                  {options}
                </Select>
                <div className="navcfg-arc-actions">
                  <button
                    type="button"
                    aria-label={t('mobileNav.moveUp', { name: label(route) })}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon icon={ArrowUp} size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('mobileNav.moveDown', { name: label(route) })}
                    disabled={busy || index === config.arc.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon icon={ArrowDown} size="sm" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('mobileNav.removeSlot', { name: label(route) })}
                    disabled={busy}
                    onClick={() => onChange(removeArcSlot(config, index))}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {config.arc.length < ARC_SLOTS && spare.length > 0 && (
            <div className="navcfg-add">
              <Select
                value={adding}
                disabled={busy}
                aria-label={t('mobileNav.addSlot')}
                onChange={(event) => setAdding(event.target.value as Route | '')}
              >
                <option value="">{t('mobileNav.addSlot')}</option>
                {spare.map((entry) => (
                  <option key={entry.route} value={entry.route}>
                    {t(entry.labelKey)}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={busy || !adding}
                onClick={() => {
                  if (!adding) return;
                  onChange(addArcSlot(config, adding));
                  setAdding('');
                }}
              >
                <Icon icon={Plus} size="sm" />
                {t('common.add')}
              </Button>
            </div>
          )}

          {/* The one rule the user cannot override, stated rather than enforced
              silently — a control that quietly refuses reads as broken. */}
          <p className="navcfg-note">{t('mobileNav.moreNote')}</p>
        </section>
      </div>
    </Card>
  );
}
