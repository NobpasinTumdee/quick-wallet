import type { TranslationKey } from '../../locales/en';

/** The sheet's texts that name the page it arranges. */
export interface ArrangeTexts {
  title: TranslationKey;
  subtitle: TranslationKey;
  /** "Show {{title}} on Home". */
  show: TranslationKey;
  resetTitle: TranslationKey;
  resetBody: TranslationKey;
}

export const HOME_ARRANGE_TEXTS: ArrangeTexts = {
  title: 'arrange.title',
  subtitle: 'arrange.subtitle',
  show: 'arrange.show',
  resetTitle: 'arrange.resetTitle',
  resetBody: 'arrange.resetBody',
};

export const ANALYTICS_ARRANGE_TEXTS: ArrangeTexts = {
  title: 'arrange.titleAnalytics',
  subtitle: 'arrange.subtitleAnalytics',
  show: 'arrange.showAnalytics',
  resetTitle: 'arrange.resetTitleAnalytics',
  resetBody: 'arrange.resetBodyAnalytics',
};

/** The Settings › Preferences row and the page's own link and toasts. */
export interface ArrangeEntryTexts {
  open: TranslationKey;
  settingLabel: TranslationKey;
  settingHint: TranslationKey;
  saved: TranslationKey;
  resetDone: TranslationKey;
  allHidden: TranslationKey;
}

export const HOME_ARRANGE_ENTRY: ArrangeEntryTexts = {
  open: 'arrange.open',
  settingLabel: 'arrange.settingLabel',
  settingHint: 'arrange.settingHint',
  saved: 'arrange.saved',
  resetDone: 'arrange.resetDone',
  allHidden: 'arrange.allHidden',
};

export const ANALYTICS_ARRANGE_ENTRY: ArrangeEntryTexts = {
  open: 'arrange.openAnalytics',
  settingLabel: 'arrange.settingLabelAnalytics',
  settingHint: 'arrange.settingHintAnalytics',
  saved: 'arrange.savedAnalytics',
  resetDone: 'arrange.resetDoneAnalytics',
  allHidden: 'arrange.allHiddenAnalytics',
};
