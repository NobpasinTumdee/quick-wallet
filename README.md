# Quick Wallet

A personal finance and investment tracker. React + TypeScript in the browser,
**Google Apps Script** as the API, and a **Google Sheet** as the database — so your
data stays a spreadsheet you can open and edit at any time.

There is no server to run. The frontend talks straight to an Apps Script Web App.

> **Migrating from the old local build?** The Node/Express backend in `backend/`
> is no longer used. See [§7 Retiring the Node backend](#7-retiring-the-node-backend)
> — in particular the password step, which is required before anyone can sign in.

---

## 1. Project structure

```
quick-wallet/
├── google-apps-script/
│   └── Code.gs                   # the entire API: routing, auth, validation,
│                                 # balances, budget maths, dashboard aggregation
│
├── backend/                      # LEGACY — the old local Express + Excel server.
│                                 # Nothing runs it any more; safe to delete.
│
└── frontend/
    ├── .env.example              # VITE_GAS_WEB_APP_URL + stock API key
    ├── index.html
    ├── public/                   # logo / favicons, served at the site root
    ├── vite.config.ts            # no dev proxy — the app calls Apps Script directly
    └── src/
        ├── App.tsx               # providers + auth gate
        ├── types.ts
        ├── api/
        │   └── client.ts         # GAS transport: path→action routing, CORS-safe
        │                         # request shaping, token handling, ApiError
        ├── hooks/
        │   ├── useExcelDB.ts     # useExcelQuery + useExcelDB (CRUD)
        │   ├── useGoogleSheet.ts # same hooks under Sheet-appropriate names
        │   └── useStockQuotes.ts # quotes → unrealised P&L
        ├── services/
        │   ├── stockApi.ts       # Finnhub / Twelve Data / simulated
        │   └── fxApi.ts          # optional exchange-rate lookup (USD → THB, …)
        ├── state/
        │   ├── AuthContext.tsx
        │   └── SettingsContext.tsx
        ├── components/           # AppShell, Logo, ui.tsx, the four forms
        ├── pages/                # Login, Dashboard, Wallets, Transactions,
        │                         # Investments, Budgets, Settings
        ├── lib/                  # format.ts, router.ts
        └── styles/
            ├── theme.css         # design tokens — light / dark / custom
            └── app.css           # layout & components
```

---

## 2. Deploying the API

1. Open your Google Sheet → **Extensions → Apps Script**. Paste in
   `google-apps-script/Code.gs`.
2. Run `generateSecrets()` from the editor, then **Project Settings → Script
   Properties** and add both values it logged:

   | Property | Purpose |
   |---|---|
   | `SESSION_SECRET` | signs session tokens |
   | `ADMIN_SECRET` | guards the one-off password reset action |

3. Run `setup()` once. It triggers the permission prompt and verifies every
   sheet and column header exists. Fix anything it logs before continuing.
4. **Deploy → New deployment → Web app**

   | Setting | Value |
   |---|---|
   | Execute as | **Me** |
   | Who has access | **Anyone** |

   "Anyone" is required — the app has no Google sign-in of its own.
5. Copy the `/exec` URL.

When you change `Code.gs`, use **Manage deployments → Edit → New version** to keep
the same URL. A *new deployment* issues a different URL and you'd have to update
the frontend.

## 3. Running the frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # paste your /exec URL into VITE_GAS_WEB_APP_URL
npm run dev                    # http://localhost:5173
```

`npm run build` produces a static `dist/` you can open from disk or host anywhere —
there's no backend to deploy alongside it.

### Stock prices

Optional. Without a key the app generates deterministic simulated prices and labels
them as such. For live quotes get a free key from
[finnhub.io](https://finnhub.io/register) or [twelvedata.com](https://twelvedata.com/pricing)
and set `VITE_STOCK_API_PROVIDER` / `VITE_STOCK_API_KEY`. Both send permissive CORS
headers, so the browser calls them directly; quotes are cached in `sessionStorage`.

---

## 4. How the request shape works (and why it's odd)

A browser sends a CORS preflight (`OPTIONS`) for anything that isn't a "simple"
request, and **Apps Script cannot answer `OPTIONS`**. So every call is shaped to
stay simple:

| | |
|---|---|
| POST bodies | `Content-Type: text/plain;charset=utf-8` holding a JSON string. `application/json` would preflight. `doPost` runs `JSON.parse(e.postData.contents)`. |
| Headers | none beyond that Content-Type. The session token rides in the **query string** (GET) or the **JSON body** (POST) — an `Authorization` header would preflight. |
| PATCH / PUT / DELETE | tunnelled through POST with a `method` field the script dispatches on. |
| Status codes | Apps Script always returns HTTP 200, so the real status is in the body. |

Envelope:

```jsonc
{ "ok": true,  "data": … }
{ "ok": false, "status": 409, "code": "WALLET_NOT_EMPTY", "error": "…" }
```

`client.ts` turns `ok:false` back into a thrown `ApiError`, so the rest of the app
catches errors exactly as it did against Express.

The REST-shaped paths are kept as the public surface and translated to script
actions, which is why no page, form or hook changed during the migration:

```
GET  /api/wallets?includeArchived=true   ->  ?action=wallets.list&includeArchived=true
POST /api/wallets                        ->  { action: "wallets.create", method: "POST", … }
PATCH /api/budgets/:id                   ->  { action: "budgets.update", query: { id }, … }
POST /api/investments/:id/sell           ->  { action: "investments.sell", query: { id }, … }
```

### Actions

```
health                    flush
auth.status               auth.register        auth.login
auth.me                   auth.changePassword  auth.resetPassword
wallets.list              wallets.get          wallets.create       wallets.update      wallets.delete
transactions.list         transactions.get     transactions.create  transactions.update transactions.delete
investments.list          investments.get      investments.symbols  investments.create
investments.update        investments.sell     investments.delete
budgets.list              budgets.get          budgets.create       budgets.update
budgets.delete            budgets.copy
subscriptions.list        subscriptions.get    subscriptions.create subscriptions.update
subscriptions.delete      subscriptions.pay
watchlist.list            watchlist.create     watchlist.update     watchlist.delete
settings.get              settings.save
dashboard.get             dashboard.periods
```

Everything except `health`, `flush`, `auth.status`, `auth.login`, `auth.register`
and `auth.resetPassword` requires a valid token, and every query is scoped to the
user that token resolves to.

---

## 5. Data model

| Sheet | Key | Notes |
|---|---|---|
| `Users` | `ID` | `Salt` + `Password Hash`. Never returned by the API. |
| `Wallets` | `ID` | `Mode` is either `expense` or `investment`. |
| `Transactions` | `ID` | A transfer is **one** row: source `Wallet ID` + `To Wallet ID`. |
| `Investments` | `ID` | Cost basis lives here; live price comes from the stock API. |
| `Budgets` | `ID` | One row per period + scope + target. |
| `Subscriptions` | `ID` | `Next Due Date` rolls forward when a payment is confirmed. |
| `Watchlist` | `ID` | Symbols tracked but not owned — no quantity, no cost basis. |
| `Settings` | `User ID` | Theme, accent, custom CSS vars, **the saved theme library**, currency, display currency + FX rate, locale, categories. |

Column headers must match `SHEETS` in `Code.gs` exactly — `setup()` checks this,
and `createMissingSheets()` creates any table a newer version of `Code.gs` adds —
and appends any column it adds — without touching existing data.

> **Upgrading to the theme library:** run `createMissingSheets()` once from the
> Apps Script editor. It appends `Custom Themes (JSON)`, `Active Custom Theme ID`
> and `Font Family` to the existing `Settings` sheet. Until it has run, saving a
> theme writes into columns the header row does not name yet and the library will
> read back empty.

**Balances** are derived, never stored:

```
expense wallet    = opening + income − expense + transfers in − transfers out
investment wallet = same, − cost basis of open positions + proceeds of closed ones
net worth         = Σ wallet balances + Σ cost basis   (the UI swaps cost basis
                                                        for live market value)
```

**Budgets** can be a fixed amount or a percentage. A percentage resolves against the
first available of: the budget's own base override → Settings → monthly income →
income actually recorded that month.

### Numbers

Every amount and quantity field accepts as many decimals as you type — fractional
shares, 8-decimal crypto, satang. They're plain text inputs (`DecimalInput`), because
`<input type="number">` blanks a half-typed value and `step` rejects extra precision.
The real ceiling is IEEE-754 double precision, ~15–17 significant digits. Currency
totals round to 2 decimals; quantities and prices keep full precision.

### Currencies

**Currency** is what amounts are stored in. **Display in another currency** converts
everything on screen at a rate you control (type it, or fetch it from
[open.er-api.com](https://open.er-api.com)). Stored values never change, so switching
back is lossless.

> Stock quotes come back in the market's own currency (USD for US tickers) and are
> compared directly against your stored cost basis. If you hold US stocks, keep
> **Currency** as `USD` and use display conversion to read totals in baht.

---

## 6. Theming

`src/styles/theme.css` is a two-layer token system:

- **Primitives** — the only names the custom theme may write: `--bg`, `--surface`,
  `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`,
  `--accent-contrast`, `--positive`, `--negative`, `--warning`, `--radius`.
- **Derived** — glass, tints, hover states, glows and shadows, all expressed as
  `color-mix()` over the primitives, so one colour change ripples through the whole UI.
- **Typography** — `--font-sans` and `--font-display` are set from the theme's
  chosen face (see below); `--font-mono` never is.

Theme selection: `:root` (light) → OS preference → `[data-theme="dark"]` →
`[data-theme="custom"]` plus inline overrides on `<html>`. `Code.gs` accepts only
the allow-listed variable names and rejects any value containing `; { } < > ( )`.

### The theme library

Settings → Appearance keeps any number of named palettes (up to 24). They live as
a JSON array in the `Settings` row rather than in a sheet of their own: Apps Script
bills per Sheets call, so riding along with the settings read the client already
does on boot is cheaper than an extra `getDataRange()` plus a `userId` filter.

Activating one *materialises* its colours into the plain `theme: 'custom'` +
`customVars` fields the app has always used, which is what lets the anti-FOUC boot
script in `index.html` paint a saved theme before first paint without knowing that
libraries exist.

**Editing never touches the network.** The colour pickers write CSS custom
properties straight onto `<html>` and keep the draft palette in a ref; React state
is a mirror refreshed at most once per frame, and a single request goes out when
you press **Save theme**. The previous build called `settings.save()` from each
picker's `onChange`, which queued hundreds of Sheets writes per drag. See
`hooks/useTheme.ts` for the whole rule, and `lib/themeStorage.ts` for the preview
lock that stops an unrelated settings refresh from wiping a live draft.

### Typography

A theme carries a typeface as well as a palette. The catalogue is in
`lib/fonts.ts` — System, Inter, Prompt, Sarabun, Noto Sans Thai and plain
`sans-serif`; the four Thai-capable ones are marked as such in the picker, which
sets every card in the face it offers.

A theme stores the catalogue **id** (`sarabun`), never a CSS font stack. The stack
is a CSS value that ends up in a custom property on `<html>`, so accepting free
text there would be an injection surface — and `sanitizeCustomVars_` caps CSS
values at 40 characters, shorter than any real stack. `Code.gs` validates the id
against `FONTS`; the client resolves it to a stack. Selecting a font rewrites
`--font-sans` and `--font-display`. `--font-mono` is left alone so figures and
tickers stay column-aligned.

Picking a built-in preset returns to the system face: the typeface belongs to the
theme, so a font you want everywhere belongs in a saved theme.

**Font FOUC is worse than colour FOUC** — a late swap re-measures every line and
shifts the layout under the reader — so the boot script in `index.html` handles it
too. `writeCachedTheme` stores the *resolved* stack and stylesheet URL next to the
id, which is what lets that script apply the font and inject the Google Fonts
`<link>` from inside `<head>` without carrying a copy of the catalogue. It only
accepts an href on `fonts.googleapis.com`, and the link id it uses is the one
`ensureFontLoaded` looks for, so the module layer finds it already present rather
than fetching the same stylesheet twice.

Opening the theme creator downloads the whole catalogue at four weights, which is
a real one-time cost (the Thai families are not small). It buys a picker that shows
each face truthfully instead of one that lies until you click; a user who never
opens Settings downloads none of it.

### The logo

Source art is at the repo root; everything the app loads is a downscaled copy in
`frontend/public/`. The transparent PNG is used throughout the UI; the
white-background one is the iOS home-screen icon. Swap the files in `public/` at the
same names to change the artwork — no code change needed.

---

## 7. Retiring the Node backend

**Passwords must be reset once.** The Express backend hashed with `scrypt`, which
Apps Script has no equivalent for — it only offers SHA-256/HMAC. Migrated hashes are
therefore unverifiable, and login fails with `PASSWORD_MIGRATION_REQUIRED` until you
re-hash. Two ways:

- **From the editor (easiest)** — open `Code.gs`, edit the two constants at the top
  of `migratePassword()`, run it once, then clear what you typed.
- **Over HTTP** — POST `auth.resetPassword` with `adminSecret`, `username` and
  `newPassword`.

Afterwards the hash is stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>`.

Once you can sign in, `backend/` is dead weight and can be deleted along with its
`node_modules` and `data/database.xlsx`.

---

## 8. Known limits

- **The Web App is a public URL.** Deployed to "Anyone", the endpoint is reachable by
  anyone who has it. Reads and writes still require a valid session token, but treat
  the `/exec` URL itself as sensitive and keep it out of anything you share publicly
  (including a committed `.env.example`).
- **Password hashing is weaker than before.** Apps Script has no scrypt/bcrypt, so
  `Code.gs` uses iterated HMAC-SHA256 (PBKDF2-style). Raise `PBKDF2_ITERATIONS` if you
  want more cost — it directly increases login latency.
- **Apps Script quotas apply**: roughly 90 min/day of runtime and 20 000 URL fetches
  on a consumer account. Normal use is nowhere near this, but a tight polling loop
  could reach it.
- **Every read loads whole sheets.** Fine into the tens of thousands of rows; it is
  not a database.
- **Concurrent writes are serialised** with `LockService`. Two browser tabs are safe;
  a stampede will queue.
- Display conversion uses one flat current rate — a March transaction is shown at
  today's rate, not March's.
- Investment P&L assumes your bookkeeping currency matches the market's.
