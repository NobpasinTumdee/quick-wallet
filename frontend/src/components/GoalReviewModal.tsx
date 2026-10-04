import { Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button, Modal } from './ui';
import { cx } from '../lib/format';
import { TranslationKey } from '../locales';
import {
  GOAL_RATING_KEYS,
  GOAL_TIERS,
  Goal,
  GoalRatingKey,
  GoalRatings,
  GoalTier,
} from '../types';

/**
 * Was it worth it?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ASKS TWICE
 * ---------------------------------------------------------------------------
 * A single "rate this purchase" score is almost useless a month later, because
 * it has nothing to be compared against. What people actually want to know
 * before buying the *next* thing is whether they were a good judge of the last
 * one — and that needs both numbers: what they expected, and what they got.
 *
 * So the form is a grid of pairs, and the gap between the two columns is the
 * whole product. A row where expectation and reality match tells you to trust
 * your judgement in that category; a row that collapses from 5 to 2 tells you
 * where you talk yourself into things.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TIER IS SEPARATE FROM THE STARS
 * ---------------------------------------------------------------------------
 * They measure different things and averaging them would lose both. The stars
 * are analytical — three specific axes, each defensible on its own. The tier
 * is a verdict, and a verdict is allowed to disagree with the arithmetic: a
 * thing can score middling on all three and still be an S because you use it
 * every single day.
 */
export function GoalReviewModal({
  open,
  goal,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  goal: Goal | undefined;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (review: { tier: GoalTier | ''; ratings: GoalRatings; reviewNote: string }) => void;
}) {
  const { t } = useTranslation();

  /* Seeded from the goal and re-seeded whenever a different one is opened.
     Keying the state on the goal's id rather than resetting it in an effect
     means there is never a frame showing the previous goal's review. */
  const [draft, setDraft] = useState(() => initialDraft(goal));
  const [seededFor, setSeededFor] = useState(goal?.id);
  if (goal && goal.id !== seededFor) {
    setSeededFor(goal.id);
    setDraft(initialDraft(goal));
  }

  const net = useMemo(() => netDelta(draft.ratings), [draft.ratings]);

  if (!goal) return null;

  const setRating = (phase: 'pre' | 'post', key: GoalRatingKey, value: number) =>
    setDraft((d) => ({
      ...d,
      ratings: { ...d.ratings, [phase]: { ...d.ratings[phase], [key]: value } },
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('goals.reviewTitle')}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => onSubmit(draft)}>
            {t('goals.saveReview')}
          </Button>
        </>
      }
    >
      <div className="review-body">
        {/* The goal's own name, under the generic modal title: the title says
            what this dialog is, this says which purchase it is about. */}
        <p className="review-subject">{goal.title}</p>
        {/* ---- Expectation vs reality ---- */}
        <section className="review-section">
          <div className="review-grid-head">
            <span />
            <span>{t('goals.expectation')}</span>
            <span>{t('goals.reality')}</span>
          </div>

          {GOAL_RATING_KEYS.map((key) => (
            <div className="review-row" key={key}>
              <span className="review-row-label">{t(RATING_LABEL[key])}</span>
              <StarInput
                value={draft.ratings.pre[key]}
                onChange={(v) => setRating('pre', key, v)}
                label={`${t(RATING_LABEL[key])} — ${t('goals.expectation')}`}
              />
              <StarInput
                value={draft.ratings.post[key]}
                onChange={(v) => setRating('post', key, v)}
                label={`${t(RATING_LABEL[key])} — ${t('goals.reality')}`}
                tone="reality"
              />
            </div>
          ))}

          {/* Only once both sides have been answered — a verdict computed from
              half a form is noise dressed as insight. */}
          {net !== null && (
            <p className={cx('review-verdict', net > 0 && 'is-up', net < 0 && 'is-down')}>
              {net === 0
                ? t('goals.verdictMet')
                : net > 0
                  ? t('goals.verdictBeat', { points: net.toFixed(1) })
                  : t('goals.verdictBelow', { points: Math.abs(net).toFixed(1) })}
            </p>
          )}
        </section>

        {/* ---- The tier ---- */}
        <section className="review-section">
          <h3 className="review-legend">{t('goals.tierPrompt')}</h3>
          <div className="tier-picker" role="radiogroup" aria-label={t('goals.tierPrompt')}>
            {GOAL_TIERS.map((tier) => (
              <button
                type="button"
                key={tier}
                role="radio"
                aria-checked={draft.tier === tier}
                className={cx('tier-chip', `is-${tier.toLowerCase()}`, draft.tier === tier && 'is-picked')}
                /* Tapping the chosen tier again clears it, so a review can be
                   un-ranked without deleting the goal. */
                onClick={() => setDraft((d) => ({ ...d, tier: d.tier === tier ? '' : tier }))}
              >
                {tier}
              </button>
            ))}
          </div>
        </section>

        {/* ---- The note ---- */}
        <section className="review-section">
          <label className="review-legend" htmlFor="goal-review-note">
            {t('goals.reviewNote')}
          </label>
          <textarea
            id="goal-review-note"
            className="input review-note-input"
            rows={3}
            maxLength={1000}
            placeholder={t('goals.reviewNotePlaceholder')}
            value={draft.reviewNote}
            onChange={(event) => setDraft((d) => ({ ...d, reviewNote: event.target.value }))}
          />
        </section>
      </div>
    </Modal>
  );
}

const RATING_LABEL: Record<GoalRatingKey, TranslationKey> = {
  value: 'goals.ratingValue',
  convenience: 'goals.ratingConvenience',
  qol: 'goals.ratingQol',
};

function initialDraft(goal: Goal | undefined) {
  return {
    tier: (goal?.tier ?? '') as GoalTier | '',
    ratings: goal?.ratings ?? blankRatings(),
    reviewNote: goal?.reviewNote ?? '',
  };
}

function blankRatings(): GoalRatings {
  const blank = { value: 0, convenience: 0, qol: 0 };
  return { pre: { ...blank }, post: { ...blank } };
}

/**
 * How far reality landed from expectation, averaged over the rated categories.
 *
 * Returns null unless at least one category has *both* sides answered, which
 * is the only case where the difference means anything. Categories left blank
 * are skipped rather than counted as zero — an unanswered row would otherwise
 * drag the average toward a disappointment nobody reported.
 */
function netDelta(ratings: GoalRatings): number | null {
  const scored = GOAL_RATING_KEYS.filter((key) => ratings.pre[key] > 0 && ratings.post[key] > 0);
  if (scored.length === 0) return null;
  const total = scored.reduce((sum, key) => sum + (ratings.post[key] - ratings.pre[key]), 0);
  return total / scored.length;
}

/**
 * Five stars, as radio buttons.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A SLIDER
 * ---------------------------------------------------------------------------
 * A slider implies a continuum and lands wherever the thumb is let go, which
 * invites a 3.4 that means nothing more than a 3. Five discrete targets each
 * big enough for a thumb is both easier to hit on a phone and honest about the
 * precision actually on offer.
 *
 * They are real radios in a real group, so arrow keys work and a screen reader
 * announces "3 of 5" rather than reading out five identical star glyphs.
 */
function StarInput({
  value,
  onChange,
  label,
  tone,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  tone?: 'reality';
}) {
  const { t } = useTranslation();

  return (
    <span className={cx('stars', tone === 'reality' && 'is-reality')} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={t('goals.starsOf', { n, total: 5 })}
          className={cx('star', n <= value && 'is-lit')}
          /* Clicking the current rating clears it back to unrated — without
             this there is no way to undo a mis-tap on a one-star row. */
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Icon icon={Star} size="sm" />
        </button>
      ))}
    </span>
  );
}
