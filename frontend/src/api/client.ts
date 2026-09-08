/**
 * Transport for the Google Apps Script Web App.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LOOKS THE WAY IT DOES
 * ---------------------------------------------------------------------------
 * Apps Script cannot answer a CORS preflight (OPTIONS), so every request has to
 * qualify as a "simple" request:
 *
 *   - POST bodies are sent as `text/plain;charset=utf-8` containing a JSON
 *     string. `Content-Type: application/json` would trigger a preflight.
 *   - No custom headers. In particular the session token travels in the query
 *     string (GET) or inside the JSON body (POST) — an `Authorization` header
 *     would preflight and fail.
 *   - PATCH / PUT / DELETE would also preflight, so they are tunnelled through
 *     POST with a `method` field that the script dispatches on.
 *
 * Apps Script also always answers HTTP 200, so the real status arrives in the
 * body as `{ ok, status, code, error }` and is converted back into a thrown
 * ApiError here. The rest of the app keeps catching ApiError exactly as before.
 *
 * The REST-shaped paths (`/api/wallets/:id`) are kept as the public surface and
 * translated to script actions (`wallets.update`) below, so `useExcelDB` and
 * every page and form carried on working unchanged through this migration.
 */

const GAS_URL = (import.meta.env.VITE_GAS_WEB_APP_URL ?? '').trim();
const TOKEN_KEY = 'quick-wallet.token';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let token: string | null = localStorage.getItem(TOKEN_KEY);
/** Notified when the script rejects our token so the app can bounce to login. */
const unauthorizedHandlers = new Set<() => void>();

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler);
  return () => unauthorizedHandlers.delete(handler);
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;
/* ------------------------------------------------------------------ */
/* Request tracing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Opt-in logging of every script call, off unless you switch it on.
 *
 * In the browser console:
 *   qwDebug.on()                every request
 *   qwDebug.on('/api/budgets')  only paths containing that string
 *   qwDebug.off()
 *
 * The flag lives in localStorage, so it survives a reload and works against a
 * production build as well as the dev server.
 */
const DEBUG_KEY = 'quick-wallet.debug';

function debugFilter(): string | null {
  try {
    return localStorage.getItem(DEBUG_KEY);
  } catch {
    return null;
  }
}

function trace(path: string, action: string, ms: number, payload: unknown, error?: unknown): void {
  const filter = debugFilter();
  if (filter === null || (filter && !path.includes(filter))) return;

  /* eslint-disable no-console */
  console.groupCollapsed(
    '%c' + (error ? '✗' : '✓') + ' ' + action + '%c ' + path + ' %c' + Math.round(ms) + 'ms',
    'color:' + (error ? '#e5484d' : '#30a46c') + ';font-weight:600',
    'color:inherit',
    'color:#888',
  );
  if (error) console.error(error);
  else console.log(payload);
  console.groupEnd();
  /* eslint-enable no-console */
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).qwDebug = {
    on: (filter = '') => {
      localStorage.setItem(DEBUG_KEY, filter);
      return filter ? 'API tracing on for paths containing "' + filter + '"' : 'API tracing on';
    },
    off: () => {
      localStorage.removeItem(DEBUG_KEY);
      return 'API tracing off';
    },
  };
}


/** Unchanged from the Express client — `useExcelQuery` uses it as its cache key. */
export function buildPath(path: string, params?: QueryParams): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/* ------------------------------------------------------------------ */
/* Path → action resolution                                            */
/* ------------------------------------------------------------------ */

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface ResolvedCall {
  action: string;
  query: Record<string, string>;
}

/** Endpoints whose name isn't derivable from the CRUD rules below. */
const NAMED_ACTIONS: Record<string, string> = {
  'health': 'health',
  'flush': 'flush',
  'auth/status': 'auth.status',
  'auth/me': 'auth.me',
  'auth/login': 'auth.login',
  'auth/register': 'auth.register',
  'auth/change-password': 'auth.changePassword',
  'auth/reset-password': 'auth.resetPassword',
  'investments/symbols': 'investments.symbols',
  'dashboard/periods': 'dashboard.periods',
  'budgets/copy': 'budgets.copy',
};

function resolve(path: string, method: HttpMethod, params?: QueryParams): ResolvedCall {
  // The path may already carry a query string: useExcelQuery calls
  // api.get(buildPath(path, params)).
  const [rawPath, rawQuery = ''] = path.split('?');

  const query: Record<string, string> = {};
  new URLSearchParams(rawQuery).forEach((value, key) => {
    query[key] = value;
  });
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      query[key] = String(value);
    }
  }

  const segments = rawPath.replace(/^\/+|\/+$/g, '').split('/');
  if (segments[0] === 'api') segments.shift();

  const named = NAMED_ACTIONS[segments.join('/')];
  if (named) return { action: named, query };

  const [resource, second, third] = segments;
  if (!resource) throw new ApiError(`Cannot route "${path}"`, 500, 'BAD_ROUTE');

  // /investments/:id/sell
  if (third) {
    return { action: `${resource}.${third}`, query: { ...query, id: second } };
  }

  // /wallets/:id — anything in the second slot at this point is an id.
  if (second) {
    const verb =
      method === 'DELETE' ? 'delete' : method === 'GET' ? 'get' : 'update';
    return { action: `${resource}.${verb}`, query: { ...query, id: second } };
  }

  // Collection-level.
  if (method === 'POST') return { action: `${resource}.create`, query };
  if (method === 'PUT') return { action: `${resource}.save`, query };

  // A couple of singular GET resources don't have a ".list".
  const listAction =
    resource === 'settings' ? 'settings.get' : resource === 'dashboard' ? 'dashboard.get' : `${resource}.list`;
  return { action: listAction, query };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: QueryParams;
  signal?: AbortSignal;
}

function assertConfigured(): void {
  if (!GAS_URL) {
    throw new ApiError(
      'VITE_GAS_WEB_APP_URL is not set. Copy frontend/.env.example to .env.local, paste your Apps Script /exec URL, and restart the dev server.',
      0,
      'CONFIG_MISSING',
    );
  }
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(GAS_URL)) {
    throw new ApiError(
      `VITE_GAS_WEB_APP_URL doesn't look like an Apps Script deployment URL (got "${GAS_URL}"). It should end in /exec.`,
      0,
      'CONFIG_INVALID',
    );
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, signal } = options;
  assertConfigured();

  const { action, query } = resolve(path, method, params);
  const startedAt = Date.now();

  let response: Response;
  try {
    if (method === 'GET') {
      const search = new URLSearchParams({ action, ...query });
      if (token) search.set('token', token);
      response = await fetch(`${GAS_URL}?${search.toString()}`, {
        method: 'GET',
        // Apps Script 302s to script.googleusercontent.com, which is where the
        // permissive CORS headers come from. The redirect must be followed.
        redirect: 'follow',
        signal,
      });
    } else {
      response = await fetch(GAS_URL, {
        method: 'POST',
        // Deliberately text/plain — see the note at the top of this file.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action,
          method,
          token: token ?? '',
          query,
          body: body ?? {},
        }),
        redirect: 'follow',
        signal,
      });
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      'Could not reach the Apps Script Web App. Check your connection, and that the deployment is set to "Anyone" access.',
      0,
      'NETWORK_ERROR',
    );
  }

  const text = await response.text();

  let payload: { ok?: boolean; data?: T; error?: string; code?: string; status?: number };
  try {
    payload = JSON.parse(text);
  } catch {
    // Apps Script serves an HTML error page when the deployment is private,
    // stale, or the script threw before our handler ran.
    const hint = /accounts\.google\.com|Sign in|Moved Temporarily/i.test(text)
      ? 'The deployment is asking for a Google login — redeploy with "Who has access: Anyone".'
      : 'The script returned HTML instead of JSON, which usually means the deployment URL is stale. Deploy a new version and update VITE_GAS_WEB_APP_URL.';
    throw new ApiError(hint, response.status || 502, 'BAD_GATEWAY');
  }

  if (!payload || payload.ok !== true) {
    const status = payload?.status ?? 500;
    if (status === 401) {
      setToken(null);
      unauthorizedHandlers.forEach((handler) => handler());
    }
    const failure = new ApiError(payload?.error || 'Request failed', status, payload?.code ?? 'UNKNOWN');
    trace(path, action, Date.now() - startedAt, undefined, failure);
    throw failure;
  }

  trace(path, action, Date.now() - startedAt, payload.data);
  return payload.data as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', params, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, params?: QueryParams) => request<T>(path, { method: 'DELETE', params }),
};
