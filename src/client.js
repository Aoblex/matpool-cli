import { loadConfig, pc } from './config.js';

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || `API error (code=${code}, HTTP ${status})`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function timeoutMs() {
  const value = Number(process.env.MATPOOL_TIMEOUT_MS || 30_000);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error('MATPOOL_TIMEOUT_MS must be an integer between 1 and 2147483647');
  }
  return value;
}

async function request(method, path, { params, body, auth, authenticated = true } = {}) {
  const base = process.env.MATPOOL_API_BASE || 'https://matpool.com/api';
  const url = new URL(base.replace(/\/+$/, '') + path);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API URL must use HTTP or HTTPS');
  const credentials = authenticated ? (auth ?? loadConfig()) : {};
  if (authenticated && !credentials.token) throw new Error('not logged in - run: matpool login');
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  let res;
  let text;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {}),
        ...(credentials.userId != null ? { 'x-matpool-user-id': String(credentials.userId) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs()),
      // Never forward credentials or repeat a mutating request to a redirect target.
      redirect: 'error',
    });
    text = await res.text();
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('request timed out; for rent/stop/release, check instance state before retrying', { cause: err });
    }
    if (err instanceof TypeError) {
      throw new Error(`network error: ${err.cause?.message || err.message}`, { cause: err });
    }
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(-1, `expected a JSON response (HTTP ${res.status})`, res.status);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(-1, `invalid API response (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.code ?? -1, data.msg || `HTTP ${res.status}`, res.status);
  }
  if (!Number.isInteger(data.code)) {
    throw new ApiError(-1, 'API response is missing a numeric status code; the upstream API may have changed', res.status);
  }
  if (data.code !== 0) throw new ApiError(data.code, data.msg, res.status);
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts = {}) => request('POST', path, { ...opts, body }),
  del: (path, body, opts = {}) => request('DELETE', path, { ...opts, body }),
};

export function handleError(err) {
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof ApiError && ([7, 176].includes(err.code) || err.status === 401)) {
    message += '\nhint: authentication failed or expired - run: matpool login';
  }
  console.error(pc.red(`error: ${message}`));
  process.exitCode = 1;
}
