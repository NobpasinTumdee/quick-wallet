import { GOAL_RATING_KEYS, Goal, GoalRatings, GoalTier } from '../types';

/**
 * The review fields of a goal, always complete.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `Goal` says `ratings: GoalRatings`, and for a row that came from the server
 * that is true — `decorateGoal_` decodes the column and always returns the full
 * shape. It is not true for every `Goal` the UI actually renders.
 *
 * An optimistic row is built from `GoalPayload`, which carries the five fields
 * a person typed and nothing else. For the moment between pressing Add and the
 * server answering, `goal.ratings` is `undefined` while the type insists it is
 * not. Reading `goal.ratings.post` on that row threw, unmounted the tree and
 * put the error boundary on screen — which looked like the app reloading on
 * save.
 *
 * The lesson is not "add a `?.`" at each site. It is that the optimistic row
 * is a different shape from the server row, and anything reading the newer
 * fields has to say what they are before the server has spoken. That is this
 * function's whole job, and it is why no component should reach for
 * `goal.ratings` directly.
 */
export interface GoalReviewView {
  tier: GoalTier | '';
  ratings: GoalRatings;
  reviewNote: string;
  reviewed: boolean;
  /**
   * Mean of the rated `post` scores, or null when nothing is rated.
   *
   * Only the categories actually scored are counted — a half-filled review
   * should not be dragged toward a disappointment nobody reported.
   */
  realityAverage: number | null;
}

function blankRatings(): GoalRatings {
  return {
    pre: { value: 0, convenience: 0, qol: 0 },
    post: { value: 0, convenience: 0, qol: 0 },
  };
}

/** Fills in whichever half of a rating set is missing or malformed. */
function normaliseRatings(raw: Goal['ratings'] | undefined): GoalRatings {
  if (!raw || typeof raw !== 'object') return blankRatings();
  const out = blankRatings();
  for (const phase of ['pre', 'post'] as const) {
    const source = raw[phase];
    if (!source || typeof source !== 'object') continue;
    for (const key of GOAL_RATING_KEYS) {
      const n = Number(source[key]);
      out[phase][key] = Number.isFinite(n) && n > 0 ? Math.min(5, Math.round(n)) : 0;
    }
  }
  return out;
}

export function goalReview(goal: Goal): GoalReviewView {
  const ratings = normaliseRatings(goal.ratings);
  const tier = (goal.tier ?? '') as GoalTier | '';
  const reviewNote = goal.reviewNote ?? '';

  const scored = GOAL_RATING_KEYS.filter((key) => ratings.post[key] > 0);
  const realityAverage = scored.length
    ? scored.reduce((sum, key) => sum + ratings.post[key], 0) / scored.length
    : null;

  /* Recomputed rather than trusting `goal.reviewed`, for the same reason the
     rest of this function exists: the server sends it, an optimistic row does
     not, and a card that reads `undefined` as "not reviewed" would be right by
     accident today and wrong the first time the flag means something else. */
  const reviewed =
    Boolean(tier) ||
    Boolean(reviewNote) ||
    GOAL_RATING_KEYS.some((key) => ratings.pre[key] > 0 || ratings.post[key] > 0);

  return { tier, ratings, reviewNote, reviewed, realityAverage };
}
