import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Button, Modal } from './ui';
import { cx } from '../lib/format';
import type { CatalogCardDef, CatalogCardId } from '../lib/layout/cardCatalog';
import type { ArrangeTexts } from '../lib/layout/arrangeTexts';
import { CARD_ICONS } from '../lib/layout/cardIcons';
import {
  type CardOrder,
  addToOrder,
  isDefaultOrder,
  moveInOrder,
  removeFromOrder,
  sameOrder,
  setOrderHidden,
} from '../lib/layout/orderModel';

/**
 * Arranging a page's cards on phones and tablets ("Arrange Home", "Arrange
 * Analytics"): the cards in order, each with ↑ / ↓ and a show switch. The
 * page passes its own cards and texts.
 *
 * Buttons rather than dragging: on a phone a drag fights the sheet's own
 * scrolling and the system's edge-swipe Back, and with seven rows two taps
 * are as quick. Everything here works the same with a screen reader or a
 * keyboard: every button says which card it moves, the ends are disabled,
 * and each change is announced.
 *
 * Edits are a draft. Done saves it (only if it differs); Cancel, Back, the
 * close button and the backdrop drop it. Reset asks first, then saves the
 * default as a marker so the user's other phones go back to it too.
 *
 * Where the page can take another page's cards (Analytics cards on Home),
 * those not on it yet are listed under "From Analytics", each with Add; an
 * added one joins the order at the end with ↑ / ↓ and Remove (instead of
 * the switch: hiding an added card removes it, so one control does).
 */
export default function ArrangeSheet<Id extends CatalogCardId>({
  registry,
  texts,
  order,
  onSave,
  onReset,
  onClose,
}: {
  registry: readonly CatalogCardDef<Id>[];
  texts: ArrangeTexts;
  order: CardOrder<Id>;
  onSave: (next: CardOrder<Id>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(order);
  const [announcement, setAnnouncement] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  /* Moving a row re-inserts its node, which drops focus; put it back on the
     button pressed — or on the other one when that end is now disabled. */
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<{ id: Id; dir: 'up' | 'down' } | null>(null);
  /* After Add or Remove: the control that now stands for that card. */
  const pendingSelector = useRef<string | null>(null);
  useEffect(() => {
    const selector = pendingSelector.current;
    pendingSelector.current = null;
    if (selector) listRef.current?.parentElement?.querySelector<HTMLElement>(selector)?.focus();
    const want = pendingFocus.current;
    pendingFocus.current = null;
    if (!want || !listRef.current) return;
    const pick = (dir: string) =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${dir}"][data-card="${want.id}"]`);
    const own = pick(want.dir);
    const target = own && !own.disabled ? own : pick(want.dir === 'up' ? 'down' : 'up');
    target?.focus();
  }, [draft]);

  const defOf = (id: Id) => registry.find((def) => def.id === id);
  const title = (id: Id): string => t(defOf(id)!.titleKey);
  /* Another page's cards (From Analytics), and the page's own optional ones (More cards). */
  const addable = registry.filter((def) => def.addable && !def.extra);
  const notAdded = addable.filter((def) => !draft.cards.some((card) => card.id === def.id));
  const extras = registry.filter((def) => def.extra);
  const extrasNotAdded = extras.filter((def) => !draft.cards.some((card) => card.id === def.id));
  const total = draft.cards.length;

  const move = (id: Id, dir: 'up' | 'down') => {
    const next = moveInOrder(draft, id, dir === 'up' ? -1 : 1);
    if (next === draft) return;
    pendingFocus.current = { id, dir };
    setDraft(next);
    const position = next.cards.findIndex((card) => card.id === id) + 1;
    setAnnouncement(t('arrange.announceMoved', { title: title(id), position, n: total }));
  };

  const toggle = (id: Id, show: boolean) => {
    setDraft(setOrderHidden(draft, id, !show));
    setAnnouncement(t(show ? 'layout.announceShown' : 'layout.announceHidden', { title: title(id) }));
  };

  const add = (id: Id) => {
    setDraft(addToOrder(draft, id));
    pendingSelector.current = `[data-remove="${id}"]`;
    setAnnouncement(t('layout.announceAdded', { title: title(id) }));
  };

  const remove = (id: Id) => {
    setDraft(removeFromOrder(draft, id));
    pendingSelector.current = `[data-add="${id}"]`;
    setAnnouncement(t('layout.announceRemoved', { title: title(id) }));
  };

  const done = () => {
    if (!sameOrder(draft, order)) onSave(draft);
    else onClose();
  };

  return (
    <>
      <Modal
        open
        title={t(texts.title)}
        onClose={onClose}
        footer={
          <div className="arrange-foot">
            <Button
              variant="ghost"
              size="sm"
              className="arrange-reset"
              disabled={isDefaultOrder(draft, registry) && isDefaultOrder(order, registry)}
              onClick={() => setConfirmReset(true)}
            >
              <Icon icon={RotateCcw} size="sm" />
              {t('layout.reset')}
            </Button>
            <div className="arrange-foot-actions">
              <Button onClick={onClose}>{t('layout.cancel')}</Button>
              <Button variant="primary" onClick={done}>
                {t('layout.done')}
              </Button>
            </div>
          </div>
        }
      >
        <p className="arrange-hint">{t(texts.subtitle)}</p>
        <ol ref={listRef} className="arrange-list">
          {draft.cards.map((card, index) => {
            const name = title(card.id);
            const shown = !card.hidden;
            const added = !!defOf(card.id)?.addable && !defOf(card.id)?.extra;
            const extra = !!defOf(card.id)?.extra;
            return (
              <li key={card.id} className={cx('arrange-row', !shown && 'is-hidden')}>
                <span className="arrange-icon" aria-hidden="true">
                  <Icon icon={CARD_ICONS[card.id]} size="sm" />
                </span>
                <span className="arrange-name">
                  <span>{name}</span>
                  {!shown && <small>{t('arrange.hiddenTag')}</small>}
                  {added && <small>{t('arrange.fromAnalyticsTag')}</small>}
                  {extra && <small>{t('arrange.addedTag')}</small>}
                </span>
                <span className="arrange-actions">
                  <button
                    type="button"
                    className="arrange-move"
                    data-move="up"
                    data-card={card.id}
                    aria-label={t('arrange.moveUp', { title: name })}
                    disabled={index === 0}
                    onClick={() => move(card.id, 'up')}
                  >
                    <Icon icon={ArrowUp} size="sm" />
                  </button>
                  <button
                    type="button"
                    className="arrange-move"
                    data-move="down"
                    data-card={card.id}
                    aria-label={t('arrange.moveDown', { title: name })}
                    disabled={index === total - 1}
                    onClick={() => move(card.id, 'down')}
                  >
                    <Icon icon={ArrowDown} size="sm" />
                  </button>
                  {added ? (
                    <button
                      type="button"
                      className="arrange-move arrange-remove"
                      data-remove={card.id}
                      aria-label={t('arrange.removeCard', { title: name })}
                      onClick={() => remove(card.id)}
                    >
                      <Icon icon={X} size="sm" />
                    </button>
                  ) : (
                    <label className="arrange-switch sub-share-toggle">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={shown}
                        aria-label={t(texts.show as 'arrange.show', { title: name })}
                        onChange={(event) => toggle(card.id, event.target.checked)}
                      />
                      <span className="sub-share-track" aria-hidden="true" />
                    </label>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {extras.length > 0 && (
          <section className="arrange-addable" aria-labelledby="arrange-extras-title">
            <h3 id="arrange-extras-title" className="section-label">
              {t('arrange.moreCards')}
            </h3>
            <p className="arrange-hint">{t('arrange.moreCardsHint')}</p>
            {extrasNotAdded.length === 0 ? (
              <p className="arrange-hint">{t('arrange.moreCardsNone')}</p>
            ) : (
              <ul className="arrange-list">
                {extrasNotAdded.map((def) => {
                  const name = t(def.titleKey);
                  return (
                    <li key={def.id} className="arrange-row">
                      <span className="arrange-icon" aria-hidden="true">
                        <Icon icon={CARD_ICONS[def.id]} size="sm" />
                      </span>
                      <span className="arrange-name">
                        <span>{name}</span>
                      </span>
                      <span className="arrange-actions">
                        <Button size="sm" data-add={def.id} aria-label={t('arrange.addCard', { title: name })} onClick={() => add(def.id)}>
                          <Icon icon={Plus} size="sm" />
                          {t('arrange.add')}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        {addable.length > 0 && (
          <section className="arrange-addable" aria-labelledby="arrange-addable-title">
            <h3 id="arrange-addable-title" className="section-label">
              {t('arrange.fromAnalytics')}
            </h3>
            <p className="arrange-hint">{t('arrange.fromAnalyticsHint')}</p>
            {notAdded.length === 0 ? (
              <p className="arrange-hint">{t('arrange.fromAnalyticsNone')}</p>
            ) : (
              <ul className="arrange-list">
                {notAdded.map((def) => {
                  const name = t(def.titleKey);
                  return (
                    <li key={def.id} className="arrange-row">
                      <span className="arrange-icon" aria-hidden="true">
                        <Icon icon={CARD_ICONS[def.id]} size="sm" />
                      </span>
                      <span className="arrange-name">
                        <span>{name}</span>
                      </span>
                      <span className="arrange-actions">
                        <Button size="sm" data-add={def.id} aria-label={t('arrange.addCard', { title: name })} onClick={() => add(def.id)}>
                          <Icon icon={Plus} size="sm" />
                          {t('arrange.add')}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmReset}
        title={t(texts.resetTitle)}
        body={t(texts.resetBody)}
        confirmLabel={t('arrange.resetConfirm')}
        onConfirm={() => {
          setConfirmReset(false);
          onReset();
        }}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}
