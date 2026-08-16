import { Router } from 'express';

import { db } from '../db/excelStore';
import { DEFAULT_CATEGORIES } from '../db/schema';
import { asyncHandler } from '../middleware/errors';
import { Settings, ThemeName } from '../types';
import { num, oneOf, str } from '../utils/validate';

export const settingsRouter = Router();

const THEMES: readonly ThemeName[] = ['light', 'dark', 'custom'];

/** CSS custom properties the client is allowed to override in `custom` theme. */
const ALLOWED_CUSTOM_VARS = new Set([
  '--bg',
  '--surface',
  '--surface-2',
  '--border',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-contrast',
  '--positive',
  '--negative',
  '--warning',
  '--radius',
]);

function fallbackSettings(userId: string): Settings {
  return {
    userId,
    theme: 'dark',
    accent: '#4f8cff',
    customVars: {},
    currency: 'USD',
    displayCurrency: '',
    fxRate: 1,
    fxRateUpdatedAt: '',
    locale: 'en-US',
    monthlyIncome: 0,
    categories: [...DEFAULT_CATEGORIES],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeCustomVars(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_CUSTOM_VARS.has(key)) continue;
    const raw = String(value ?? '').trim();
    // Anything that could break out of a CSS declaration is dropped.
    if (!raw || raw.length > 40 || /[;{}<>()]/.test(raw)) continue;
    out[key] = raw;
  }
  return out;
}

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Settings>('Settings', req.userId);
    if (existing) {
      // Older rows predate some columns.
      if (!existing.categories?.length) existing.categories = [...DEFAULT_CATEGORIES];
      if (!(existing.fxRate > 0)) existing.fxRate = 1;
      res.json(existing);
      return;
    }
    res.json(db.insert<Settings>('Settings', fallbackSettings(req.userId)));
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const current = db.findById<Settings>('Settings', req.userId) ?? fallbackSettings(req.userId);

    const next: Settings = {
      ...current,
      userId: req.userId,
      theme: body.theme !== undefined ? oneOf<ThemeName>(body.theme, 'theme', THEMES) : current.theme,
      accent: body.accent !== undefined ? str(body.accent, 'accent', { max: 20 }) : current.accent,
      customVars:
        body.customVars !== undefined ? sanitizeCustomVars(body.customVars) : current.customVars,
      currency:
        body.currency !== undefined
          ? str(body.currency, 'currency', { max: 8 }).toUpperCase()
          : current.currency,
      displayCurrency:
        body.displayCurrency !== undefined
          ? str(body.displayCurrency, 'displayCurrency', { required: false, max: 8 }).toUpperCase()
          : current.displayCurrency,
      fxRate: body.fxRate !== undefined ? num(body.fxRate, 'fxRate', { min: 0 }) : current.fxRate,
      fxRateUpdatedAt:
        body.fxRate !== undefined ? new Date().toISOString() : current.fxRateUpdatedAt,
      locale: body.locale !== undefined ? str(body.locale, 'locale', { max: 12 }) : current.locale,
      monthlyIncome:
        body.monthlyIncome !== undefined
          ? num(body.monthlyIncome, 'monthlyIncome', { min: 0 })
          : current.monthlyIncome,
      categories: body.categories !== undefined ? normalizeCategories(body.categories) : current.categories,
      updatedAt: new Date().toISOString(),
    };

    res.json(db.upsert<Settings>('Settings', next));
  }),
);

function normalizeCategories(input: unknown): string[] {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const cleaned = list
    .map((c) => String(c).trim())
    .filter(Boolean)
    .slice(0, 100);
  // Case-insensitive de-dupe, first spelling wins.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cleaned) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.length ? out : [...DEFAULT_CATEGORIES];
}
