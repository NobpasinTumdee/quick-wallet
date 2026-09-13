import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TranslationKey } from '../locales';
import { Icon } from './Icon';

/**
 * One destination in a directory of destinations.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROW AND NOT A TILE
 * ---------------------------------------------------------------------------
 * The obvious build for an app directory is a grid of square icon tiles. It is
 * the wrong shape here, because every entry carries a line of description and a
 * tile 150px wide cannot hold "Estimate your yearly tax and deductions" at a
 * size anyone reads — the description either wraps to four lines or gets cut,
 * and in both cases it stops being worth rendering.
 *
 * So this is a row: icon, then title over description, then a chevron. It is
 * full-width on a phone and lets the grid place two or three side by side once
 * there is room, which is the one layout that keeps the description legible at
 * every width. It is also the shape people already know from every settings
 * screen they have ever used.
 *
 * ---------------------------------------------------------------------------
 * WHY IT TAKES KEYS RATHER THAN STRINGS
 * ---------------------------------------------------------------------------
 * Same reason NAV does in AppShell: a directory is defined as a module-level
 * table, built once at import. A translated string put in that table is frozen
 * to whichever language happened to be active when the module loaded. Holding
 * the key and resolving it here moves the lookup inside the render pass, where
 * `useTranslation` has subscribed to `languageChanged` — so switching language
 * updates the whole directory.
 */
export function MenuCard({
  labelKey,
  descriptionKey,
  icon,
  onClick,
  onPrefetch,
}: {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  onClick: () => void;
  /** Warms this destination's data. Fired on the events that precede a tap. */
  onPrefetch?: () => void;
}) {
  const { t } = useTranslation();

  /* No "you are here" state, deliberately. The only directory in the app lives
     on its own route and does not list itself, so a current-page marker here
     could never fire — and an active style nothing can reach is a thing that
     rots quietly and misleads the next reader. Three lines to add back if a
     directory ever renders alongside the screens it lists. */
  return (
    <button
      type="button"
      className="menu-card"
      /* A pointer takes 200-400ms to travel and click and a touch lands ~100ms
         before the click resolves, which is a real head start on a request that
         takes 1-3s. Focus is in there for keyboard users, who otherwise get the
         one path with no warm-up at all. */
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
      onFocus={onPrefetch}
      onClick={onClick}
    >
      <span className="menu-card-icon" aria-hidden="true">
        <Icon icon={icon} />
      </span>

      <span className="menu-card-text">
        <span className="menu-card-title">{t(labelKey)}</span>
        <span className="menu-card-desc">{t(descriptionKey)}</span>
      </span>

      <span className="menu-card-chevron" aria-hidden="true">
        <Icon icon={ChevronRight} size="sm" />
      </span>
    </button>
  );
}
