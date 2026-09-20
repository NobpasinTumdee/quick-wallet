import { Check, Pencil, Plus, X } from 'lucide-react';
import { KeyboardEvent, forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Icon } from './Icon';
import { Card } from './ui';
import {
  CategoryProblem,
  MAX_CATEGORIES,
  MAX_CATEGORY_LENGTH,
  addCategory,
  canRemove,
  parseCategories,
  removeCategory,
  renameCategory,
  sameCategories,
  validateCategory,
  withFallback,
} from '../lib/categories';
import { cx } from '../lib/format';

/**
 * The category manager.
 *
 * ---------------------------------------------------------------------------
 * WHY CHIPS AND NOT A TEXT FIELD
 * ---------------------------------------------------------------------------
 * The old control was the stored value shown raw: one input holding
 * "Salary, Rent, Dining, …". Editing one name meant finding it inside a long
 * line and being careful with the commas around it; a stray one added an empty
 * category, and a duplicate was accepted here and silently dropped by the
 * server. Nothing about it said "this is a list of things".
 *
 * A chip is the thing itself. It can be renamed in place, removed on its own,
 * and counted at a glance, and there is no punctuation to get wrong because
 * the separator is no longer something the user types.
 *
 * ---------------------------------------------------------------------------
 * WHY IT SAVES AS YOU GO
 * ---------------------------------------------------------------------------
 * Same argument the mobile-nav and payday editors make. This is direct
 * manipulation: you delete a chip and it is gone. A Save button below the fold
 * that must also be pressed is how people discover, later, that the work was
 * discarded. Each change writes immediately through the optimistic `save`,
 * which rolls back and toasts on failure.
 *
 * ---------------------------------------------------------------------------
 * VALIDATION HAPPENS HERE, NOT ONLY ON THE SERVER
 * ---------------------------------------------------------------------------
 * `normalizeCategories_` would drop a duplicate without a word, so the chip
 * the user just typed would vanish on the next load. The same rules run in
 * `lib/categories.ts` before the write, and the reason is said in place.
 */

/**
 * Each branch names its key as a literal on purpose.
 *
 * A `Record<CategoryProblem, TranslationKey>` and one dynamic `t(KEY[problem],
 * { max })` reads tidier and does not type-check: `TranslationKey` is the
 * union of *every* key, most of which take no interpolation, so the call
 * cannot prove `max` belongs. Spelling the four out keeps the dictionary's
 * type guarantee — a renamed key fails the build here rather than rendering
 * its own name to the user.
 */
function problemMessage(problem: CategoryProblem, t: TFunction): string {
  switch (problem) {
    case 'empty':
      return t('categories.errorEmpty');
    case 'duplicate':
      return t('categories.errorDuplicate');
    case 'tooLong':
      return t('categories.errorTooLong', { max: MAX_CATEGORY_LENGTH });
    case 'tooMany':
      return t('categories.errorTooMany', { max: MAX_CATEGORIES });
  }
}

export function CategorySettings({
  value,
  onChange,
  busy,
}: {
  /** Whatever is stored — an array, or a comma-separated string. */
  value: unknown;
  onChange: (next: string[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();

  const categories = withFallback(parseCategories(value));

  /** Which chip is being renamed, or 'new' for the add-chip. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<CategoryProblem | null>(null);
  /** Said out loud rather than shown as a colour on a disabled control. */
  const [lastGuard, setLastGuard] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editing !== null) inputRef.current?.focus();
  }, [editing]);

  function open(target: number | 'new') {
    setEditing(target);
    setDraft(typeof target === 'number' ? categories[target] : '');
    setProblem(null);
    setLastGuard(false);
  }

  function close() {
    setEditing(null);
    setDraft('');
    setProblem(null);
  }

  function commit() {
    if (editing === null) return;
    const index = editing === 'new' ? null : editing;
    const found = validateCategory(draft, categories, index);
    if (found) {
      setProblem(found);
      return;
    }

    const next =
      editing === 'new' ? addCategory(categories, draft) : renameCategory(categories, editing, draft);
    /* A rename that changes nothing still closes the editor, but must not
       write: an idle save would toast, bump the settings and re-render the
       page for a no-op. */
    if (!sameCategories(next, categories)) onChange(next);
    close();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function remove(index: number) {
    if (!canRemove(categories)) {
      setLastGuard(true);
      return;
    }
    setLastGuard(false);
    onChange(removeCategory(categories, index));
  }

  const full = categories.length >= MAX_CATEGORIES;

  return (
    <Card title={t('categories.title')} subtitle={t('categories.subtitle')}>
      <div className={cx('cat-manager', busy && 'is-busy')}>
        <ul className="cat-chips">
          {categories.map((category, index) => (
            <li key={`${category}-${index}`}>
              {editing === index ? (
                <ChipInput
                  ref={inputRef}
                  value={draft}
                  invalid={Boolean(problem)}
                  label={t('categories.renameField', { name: category })}
                  onChange={(next) => {
                    setDraft(next);
                    setProblem(null);
                  }}
                  onKeyDown={onKey}
                  onBlur={commit}
                  onConfirm={commit}
                />
              ) : (
                <span className="cat-chip">
                  <span className="cat-chip-name">{category}</span>
                  {/* Present always, faded until the chip is hovered or
                      something inside it has focus — a control that appears
                      only on hover does not exist for a keyboard. */}
                  <button
                    type="button"
                    className="cat-chip-action"
                    disabled={busy}
                    aria-label={t('categories.rename', { name: category })}
                    title={t('categories.rename', { name: category })}
                    onClick={() => open(index)}
                  >
                    <Icon icon={Pencil} size="sm" />
                  </button>
                  <button
                    type="button"
                    className="cat-chip-action is-remove"
                    disabled={busy}
                    aria-label={t('categories.remove', { name: category })}
                    title={t('categories.remove', { name: category })}
                    onClick={() => remove(index)}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </span>
              )}
            </li>
          ))}

          <li>
            {editing === 'new' ? (
              <ChipInput
                ref={inputRef}
                value={draft}
                invalid={Boolean(problem)}
                label={t('categories.newField')}
                placeholder={t('categories.newPlaceholder')}
                onChange={(next) => {
                  setDraft(next);
                  setProblem(null);
                }}
                onKeyDown={onKey}
                onBlur={commit}
                onConfirm={commit}
              />
            ) : (
              <button
                type="button"
                className="cat-add"
                disabled={busy || full}
                onClick={() => open('new')}
              >
                <Icon icon={Plus} size="sm" />
                {t('categories.add')}
              </button>
            )}
          </li>
        </ul>

        {/* One line, and only one: the newest reason takes the slot rather than
            stacking messages the user has already dealt with. */}
        <p className={cx('cat-note', (problem || lastGuard) && 'is-error')} role="status">
          {problem
            ? problemMessage(problem, t)
            : lastGuard
              ? t('categories.errorLast')
              : full
                ? t('categories.atLimit', { max: MAX_CATEGORIES })
                : t('categories.hint', { count: categories.length })}
        </p>
      </div>
    </Card>
  );
}

interface ChipInputProps {
  value: string;
  invalid: boolean;
  label: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onConfirm: () => void;
}

/**
 * The chip, in its editing state.
 *
 * It keeps the chip's footprint so the row does not reflow when editing opens
 * — a list that jumps as you click into it makes the next chip a moving
 * target. Blur commits rather than cancels: clicking away from a name you have
 * typed means you are done with it, and losing the text would be the one
 * outcome nobody wants. Escape is the way out that discards.
 */
const ChipInput = forwardRef<HTMLInputElement, ChipInputProps>(function ChipInput(props, ref) {
  const { t } = useTranslation();

  return (
    <span className={cx('cat-chip', 'is-editing', props.invalid && 'is-invalid')}>
      <input
        ref={ref}
        className="cat-chip-input"
        value={props.value}
        aria-label={props.label}
        aria-invalid={props.invalid}
        placeholder={props.placeholder}
        maxLength={MAX_CATEGORY_LENGTH}
        /* Grows with the text, so a long name is not typed through a keyhole
           and a short one does not leave a gap in the row. */
        size={Math.max(8, props.value.length + 2)}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
        onBlur={props.onBlur}
      />
      {/* A tap target for what Enter does: on a phone the keyboard covers the
          chip and "press Enter" is not obvious. `onMouseDown` rather than
          `onClick`, or the input's blur would fire first and the button would
          be gone before the click landed. */}
      <button
        type="button"
        className="cat-chip-action is-confirm"
        aria-label={t('common.save')}
        onMouseDown={(event) => {
          event.preventDefault();
          props.onConfirm();
        }}
      >
        <Icon icon={Check} size="sm" />
      </button>
    </span>
  );
});
