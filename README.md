# Quick Wallet

A local, offline-first personal finance and investment tracker. React + TypeScript on the front,
Express on the back, and a plain `database.xlsx` workbook as the database — so your data stays a
file you can open in Excel whenever you like.

Nothing is deployed and nothing phones home, with one optional exception: if you configure a stock
API key, the browser fetches live quotes for your positions.

---

## 1. Project structure

```
quick-wallet/
├── backend/
│   ├── .env.example              # PORT, DB_PATH, token TTL, flush debounce
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/                     # created on first run (git-ignored)
│   │   ├── database.xlsx         # ← the database
│   │   └── .session-secret       # HMAC key for session tokens
│   └── src/
│       ├── server.ts             # Express app, health/flush routes, graceful shutdown
│       ├── config.ts             # env parsing + resolved paths
│       ├── types.ts              # domain interfaces (mirrored on the frontend)
│       ├── db/
│       │   ├── schema.ts         # declarative sheet + column definitions
│       │   └── excelStore.ts     # workbook init, migration, cache, atomic writes
│       ├── middleware/
│       │   ├── auth.ts           # scrypt hashing, HMAC tokens, requireAuth
│       │   └── errors.ts         # asyncHandler, 404, central error handler
│       ├── services/
│       │   └── finance.ts        # balances + budget progress calculations
│       ├── routes/
│       │   ├── auth.ts           # /api/auth  register, login, me, change-password
│       │   ├── wallets.ts        # /api/wallets
│       │   ├── transactions.ts   # /api/transactions
│       │   ├── investments.ts    # /api/investments (+ /:id/sell, /symbols)
│       │   ├── budgets.ts        # /api/budgets (+ /copy)
│       │   ├── settings.ts       # /api/settings
│       │   └── dashboard.ts      # /api/dashboard (+ /periods)
│       └── utils/
│           └── validate.ts       # input coercion & validation helpers
│
└── frontend/
    ├── .env.example              # VITE_STOCK_API_KEY and friends
    ├── index.html
    ├── public/                   # served at the site root, not bundled
    │   ├── logo.png              # 512, transparent — used in the UI
    │   ├── logo-128.png          # small mark (sidebar / mobile topbar)
    │   ├── favicon-32.png        # browser tab
    │   ├── favicon-64.png
    │   ├── apple-touch-icon.png  # 180, white background for iOS
    │   └── logo-social.png       # 512, white background
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts            # proxies /api → localhost:4000
    └── src/
        ├── main.tsx
        ├── App.tsx               # providers + auth gate
        ├── types.ts
        ├── api/
        │   └── client.ts         # fetch wrapper, token storage, ApiError
        ├── hooks/
        │   ├── useExcelDB.ts     # useExcelQuery + useExcelDB (CRUD)
        │   └── useStockQuotes.ts # quotes → unrealised P&L
        ├── services/
        │   ├── stockApi.ts       # Finnhub / Twelve Data / simulated
        │   └── fxApi.ts          # optional exchange-rate lookup (USD → THB, …)
        ├── state/
        │   ├── AuthContext.tsx
        │   └── SettingsContext.tsx   # loads settings, applies theme to <html>
        ├── components/
        │   ├── AppShell.tsx      # sidebar + mobile tab bar + period picker
        │   ├── Logo.tsx          # the brand mark
        │   ├── ui.tsx            # Card, Button, Field, Modal, DecimalInput, …
        │   ├── WalletForm.tsx
        │   ├── TransactionForm.tsx
        │   ├── InvestmentForm.tsx
        │   └── BudgetForm.tsx
        ├── pages/
        │   ├── LoginPage.tsx
        │   ├── DashboardPage.tsx
        │   ├── WalletsPage.tsx
        │   ├── TransactionsPage.tsx
        │   ├── InvestmentsPage.tsx
        │   ├── BudgetsPage.tsx
        │   └── SettingsPage.tsx
        ├── lib/
        │   ├── format.ts         # money/date/percent formatting
        │   └── router.ts         # tiny hash router
        └── styles/
            ├── theme.css         # :root tokens — light / dark / custom
            └── app.css           # layout & components
```

---

## 2. Running it

You need Node 18 or newer. Open **two terminals**.

**Terminal 1 — backend**

```bash
cd backend
npm install
cp .env.example .env      # optional; every value has a default
npm run dev               # http://localhost:4000
```

On first start it creates `backend/data/database.xlsx` with all six sheets
(Users, Wallets, Transactions, Investments, Budgets, Settings) and prints the path.

**Terminal 2 — frontend**

```bash
cd frontend
npm install
cp .env.example .env.local   # optional; needed only for live stock prices
npm run dev                  # http://localhost:5173
```

Open http://localhost:5173. The workbook has no users yet, so the first screen asks you to create a
profile; it seeds a starter "Cash" wallet and a default settings row for you.

**Production-ish build** (still local): `npm run build` in each folder, then `npm start` in
`backend/` and `npm run preview` in `frontend/`.

### Stock prices

Live quotes are optional. Without a key the app generates deterministic simulated prices and labels
them as such everywhere they appear. To go live, get a free key from
[finnhub.io](https://finnhub.io/register) or [twelvedata.com](https://twelvedata.com/pricing) and put
it in `frontend/.env.local`:

```
VITE_STOCK_API_PROVIDER=finnhub
VITE_STOCK_API_KEY=your_key_here
```

Both providers send permissive CORS headers, so the browser calls them directly. Quotes are cached in
`sessionStorage` for 60s (configurable) to stay inside free-tier rate limits.

---

## 3. How the data model works

| Sheet | Key | Notes |
|---|---|---|
| `Users` | `id` | `salt` + scrypt `passwordHash`. Never returned by the API. |
| `Wallets` | `id` | `mode` is either `expense` or `investment`. |
| `Transactions` | `id` | A transfer is **one** row: source `walletId` + `toWalletId`. |
| `Investments` | `id` | Cost basis lives here; live price comes from the stock API. |
| `Budgets` | `id` | One row per period + scope + target. |
| `Settings` | `userId` | Theme, accent, custom CSS vars, currency, display currency + FX rate, locale, categories. |

Every request after login carries a bearer token; the backend resolves it to a user id and scopes
every query, so multiple profiles share one workbook without seeing each other's rows.

**Balances** are derived, never stored:

```
expense wallet    = opening + income − expense + transfers in − transfers out
investment wallet = same, − cost basis of open positions + proceeds of closed ones
net worth         = Σ wallet balances + Σ cost basis   (the UI swaps cost basis
                                                        for live market value)
```

**Budgets** can be a fixed amount or a percentage. A percentage resolves against the first available
of: the budget's own base override → Settings → monthly income → income actually recorded that month.

### Numbers

Every amount and quantity field accepts as many decimal places as you want to type — fractional
shares, 8-decimal crypto, satang. They are plain text inputs (`DecimalInput` in `components/ui.tsx`)
rather than `<input type="number">`, because the browser blanks a number input while a value is
half-typed and a `step` attribute rejects anything more precise than the step. The raw string is kept
while you type and parsed once on submit.

Values are stored as ordinary numbers, so the real ceiling is IEEE-754 double precision — about 15–17
significant digits. Currency *totals* are rounded to 2 decimals for display and storage; quantities
and prices keep whatever precision you entered.

### Currencies

Two separate settings:

- **Currency** — the bookkeeping currency. Everything in the workbook is denominated in it.
- **Display in another currency** — optional. Set a target (e.g. `THB`) and a rate, and every amount
  on screen is converted at read time. Nothing stored changes, so switching back is lossless and you
  can flip between them freely.

The rate is yours to control: type it, or press **Fetch today's rate** to pull it from
[open.er-api.com](https://open.er-api.com) (free, no key, the only network call besides stock
quotes). It is never refreshed behind your back — the number you saved is the number used, and
Settings shows when it last changed.

Inputs always stay in the bookkeeping currency and are labelled with it; where it helps, forms show
the converted equivalent underneath.

> Stock quotes come back in the market's own currency (USD for US tickers) and are compared directly
> against your stored cost basis. So if you hold US stocks, keep **Currency** as `USD` and use the
> display conversion to read your totals in baht — that keeps P&L correct. Settings warns you if the
> two are inconsistent.

---

## 4. Editing `database.xlsx` by hand

You can. Two things to know:

- **The server keeps the workbook in memory.** It reads the file once at startup and writes it back
  after changes. If you edit the file while the server is running, restart the server or your edits
  get overwritten. Use *Settings → Save workbook now* before you open it.
- **If the file is open in Excel, writes fail.** Windows locks it. The backend detects this, keeps
  your changes in memory, retries every 5 seconds, and the UI shows a banner. Close Excel and the
  queued changes land automatically — nothing is lost unless you kill the server first.

Adding a column to a sheet by hand is safe: unknown columns are ignored. Removing one is also safe —
the server re-adds it on the next write. Rows without an id are skipped.

---

## 5. API reference

All routes except `/api/health`, `/api/flush` and `/api/auth/*` require `Authorization: Bearer <token>`.

```
GET    /api/health                     workbook status (locked? dirty? row counts)
POST   /api/flush                      force a save to disk

GET    /api/auth/users                 profiles on this machine (for the login screen)
POST   /api/auth/register              { username, password, displayName }
POST   /api/auth/login                 { username, password } → { token, user }
GET    /api/auth/me
POST   /api/auth/change-password

GET    /api/wallets                    ?includeArchived — returns computed balances
POST   /api/wallets
PATCH  /api/wallets/:id
DELETE /api/wallets/:id                ?cascade=true also deletes its records

GET    /api/transactions               ?walletId&type&category&period&from&to&search&limit
POST   /api/transactions
PATCH  /api/transactions/:id
DELETE /api/transactions/:id

GET    /api/investments                ?walletId&status&symbol&tag
GET    /api/investments/symbols        distinct held tickers
POST   /api/investments
POST   /api/investments/:id/sell       { sellPrice, sellDate }
PATCH  /api/investments/:id
DELETE /api/investments/:id

GET    /api/budgets                    ?period=YYYY-MM → budgets with progress + totals
POST   /api/budgets
POST   /api/budgets/copy               { from, to }
PATCH  /api/budgets/:id
DELETE /api/budgets/:id

GET    /api/settings
PUT    /api/settings

GET    /api/dashboard                  ?period=YYYY-MM
GET    /api/dashboard/periods          months that contain data
```

Errors are always `{ error: string, code: string }` with a meaningful status.

---

## 6. Theming

`src/styles/theme.css` declares every colour, radius and shadow as a custom property on `:root`.
Switching themes swaps token values — no component CSS changes.

- `:root` — light palette (the base set)
- `@media (prefers-color-scheme: dark)` on `:root:not([data-theme])` — follows the OS before React boots
- `:root[data-theme="dark"]` — explicit choice, beats the OS
- `:root[data-theme="custom"]` — a starting palette; `SettingsContext` writes individual properties
  inline on `<html>`, which override everything above

The backend only accepts a fixed allow-list of variable names and rejects any value containing
`; { } < > ( )`, so a custom palette can't smuggle CSS into the page.

### The logo

Source art lives at the repo root (`quickfinancial.png` on white, `quickfinancialPNG.png`
transparent, both 992×992). Everything the app actually loads is a downscaled copy in
`frontend/public/` — a 992px, 1 MB PNG behind a 30px sidebar mark is a lot of bytes for nothing.

The **transparent** version is used throughout the UI so it sits correctly on light, dark and custom
themes. The **white-background** version is used only for the iOS home-screen icon, because iOS
composites transparency onto black.

`<Logo size={n} />` picks the right file for the requested size. To swap the artwork, replace the
files in `frontend/public/` at the same names and sizes — no code changes needed. To regenerate them
from a new source image, any image editor will do; the sizes are 512 / 128 / 64 / 32 / 180.

---

## 7. Known limits

- Auth is deliberately light: scrypt hashes and HMAC tokens, but no rate limiting or lockout. It
  separates profiles on a machine you already control — it is not internet-grade.
- The whole workbook is held in memory. That is fine for tens of thousands of rows; it is not a
  database.
- Only one server process may own the workbook at a time. Don't run two backends against one file.
- Display conversion is a single flat rate across the whole app — it converts today's view, it does
  not store historical rates. A transaction from March is converted at the rate you have saved now,
  not the rate that applied in March.
- Investment P&L assumes your bookkeeping currency matches the market's. Positions quoted in a
  different currency are not FX-adjusted before P&L is calculated.
