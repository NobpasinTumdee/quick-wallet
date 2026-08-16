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
auth.users                auth.register        auth.login
auth.me                   auth.changePassword  auth.resetPassword
wallets.list              wallets.get          wallets.create       wallets.update      wallets.delete
transactions.list         transactions.get     transactions.create  transactions.update transactions.delete
investments.list          investments.get      investments.symbols  investments.create
investments.update        investments.sell     investments.delete
budgets.list              budgets.get          budgets.create       budgets.update
budgets.delete            budgets.copy
settings.get              settings.save
dashboard.get             dashboard.periods
```

Everything except `health`, `flush`, `auth.users`, `auth.login`, `auth.register`
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
| `Settings` | `User ID` | Theme, accent, custom CSS vars, currency, display currency + FX rate, locale, categories. |

Column headers must match `SHEETS` in `Code.gs` exactly — `setup()` checks this.

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

Theme selection: `:root` (light) → OS preference → `[data-theme="dark"]` →
`[data-theme="custom"]` plus inline overrides on `<html>`. `Code.gs` accepts only
the allow-listed variable names and rejects any value containing `; { } < > ( )`.

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
