import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { MAX_PAYDAYS, resolvePaydays } from '../lib/mobileNav';
import { Button, Card, Select } from './ui';

/**
 * Which days of the month a salary lands.
 *
 * ---------------------------------------------------------------------------
 * WHY A LIST AND NOT ONE NUMBER
 * ---------------------------------------------------------------------------
 * Being paid twice a month is ordinary — the 1st and the 16th, or every second
 * Friday approximated as four dates. With a single anchor the liability
 * heatmap's central reading, "what falls due before you next get paid", was
 * simply wrong for those people: everything after the one payday counted as
 * funded, including bills three weeks later that a second cheque had not
 * arrived for yet.
 *
 * ---------------------------------------------------------------------------
 * WHY DAY 29-31 IS ALLOWED
 * ---------------------------------------------------------------------------
 * It is a real choice and some people are genuinely paid on the last day. The
 * month that has no 31st simply draws no marker, which is the truth — clamping
 * it to the 28th would invent a payday that did not happen. The hint says so
 * rather than leaving the reader to discover it in February.
 */
export function PaydaySettings({
  value,
  onChange,
  busy,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const paydays = resolvePaydays(value);
  const [adding, setAdding] = useState('');

  const available = Array.from({ length: 31 }, (_, index) => index + 1).filter(
    (day) => !paydays.includes(day),
  );
  const full = paydays.length >= MAX_PAYDAYS;

  return (
    <Card title={t('payday.title')} subtitle={t('payday.subtitle')}>
      <div className="payday">
        {paydays.length === 0 ? (
          <p className="payday-empty">{t('payday.none')}</p>
        ) : (
          <ul className="payday-chips">
            {paydays.map((day) => (
              <li key={day} className="payday-chip">
                <span>{t('payday.dayLabel', { day })}</span>
                <button
                  type="button"
                  aria-label={t('payday.remove', { day })}
                  disabled={busy}
                  onClick={() => onChange(paydays.filter((other) => other !== day))}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!full && (
          <div className="payday-add">
            <Select
              value={adding}
              disabled={busy}
              aria-label={t('payday.add')}
              onChange={(event) => setAdding(event.target.value)}
            >
              <option value="">{t('payday.add')}</option>
              {available.map((day) => (
                <option key={day} value={day}>
                  {t('payday.dayLabel', { day })}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={busy || !adding}
              onClick={() => {
                if (!adding) return;
                onChange(resolvePaydays([...paydays, Number(adding)]));
                setAdding('');
              }}
            >
              <Icon icon={Plus} size="sm" />
              {t('common.add')}
            </Button>
          </div>
        )}

        <p className="payday-hint">{full ? t('payday.limit', { max: MAX_PAYDAYS }) : t('payday.hint')}</p>
      </div>
    </Card>
  );
}
