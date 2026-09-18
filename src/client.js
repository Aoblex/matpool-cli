import { loadConfig, die } from './config.js';

const BASE_URL = process.env.MATPOOL_API_BASE || 'https://matpool.com/api';

export class ApiError extends Error {
  constructor(code, msg, status) {
    super(msg || `api error (code=${code})`);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, { params, body, headers } = {}) {
  const cfg = loadConfig();
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
      ...(cfg.userId ? { 'x-matpool-user-id': String(cfg.userId) } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(-1, `invalid JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  // Matpool wraps business status in a `code` field; 0 means success.
  if (data && typeof data.code === 'number' && data.code !== 0) {
    throw new ApiError(data.code, data.msg, res.status);
  }
  if (!res.ok) {
    throw new ApiError(data.code ?? -1, data.msg || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts = {}) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts = {}) => request('PATCH', path, { ...opts, body }),
  del: (path, body, opts = {}) => request('DELETE', path, { ...opts, body }),
};

export function handleError(err) {
  if (err instanceof ApiError) {
    die(err.message);
  }
  if (err.cause) {
    die(`network error: ${err.cause.message || err.message}`);
  }
  die(err.message);
}
