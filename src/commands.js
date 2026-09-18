import { api } from './client.js';
import { loadConfig, saveConfig } from './config.js';
import { loginInput, confirmAction, spin, json, extractList, listResponse, detailResponse } from './ui.js';

export function positiveInteger(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive safe integer`);
  return number;
}

export function queryParams(values = []) {
  return Object.fromEntries(values.map((value) => {
    const index = value.indexOf('=');
    if (index <= 0 || !value.slice(0, index).trim()) throw new Error(`invalid key=value pair: ${value}`);
    return [value.slice(0, index), value.slice(index + 1)];
  }));
}

function responseData(res) {
  if (!Object.hasOwn(res, 'data')) throw new Error('API response is missing data; the upstream API may have changed');
  return res.data;
}

function environment(value) {
  if (value === undefined) return undefined;
  try { JSON.parse(value); } catch { throw new Error('--env must be valid JSON'); }
  // The reverse-engineered form sends envs as a JSON string, not an object.
  return value;
}

async function list(path, label, opts, params = {}) {
  const res = await spin(`Fetching ${label}…`, () => api.get(path, { params }));
  listResponse(responseData(res), opts.json);
}

async function detail(path, label, opts, params = {}) {
  const res = await spin(`Fetching ${label}…`, () => api.get(path, { params }));
  detailResponse(responseData(res), opts.json);
}

export const commands = {
  async login(opts) {
    const credentials = await loginInput(opts);
    const cfg = loadConfig();
    const body = /^1\d{10}$/.test(credentials.name)
      ? { mobile: credentials.name, password: credentials.password }
      : credentials;
    const res = await spin('Logging in…', () => api.post('/login', body, { authenticated: false }));
    if (typeof res.token !== 'string' || !res.token) throw new Error('login response did not contain a token');
    const info = await spin('Fetching user info…', () => api.get('/user', { auth: { token: res.token } }));
    const user = info.data ?? info;
    const id = positiveInteger(user.id, 'user ID returned by API');
    // Only replace credentials once the entire login succeeds.
    saveConfig({ ...cfg, token: res.token, userId: id });
    console.error(`Logged in as ${credentials.name} (uid=${id})`);
  },

  async logout() {
    const cfg = loadConfig();
    const { token, userId, ...rest } = cfg;
    saveConfig(rest);
    console.error('Local credentials removed.');
    if (!token) return;
    try {
      await spin('Invalidating remote session…', () => api.post('/user/logout', undefined, { auth: { token, userId } }));
    } catch (err) {
      console.error(`Warning: remote session could not be invalidated: ${err.message}`);
    }
  },

  whoami: (opts) => detail('/user', 'user info', opts),
  balance: (opts) => detail('/user/account', 'balance', opts),
  machines(opts) {
    const params = queryParams(opts.param);
    if (opts.category) params.category = opts.category;
    return list('/machines', 'machines', opts, params);
  },
  hardwares: (opts) => list('/hardwares', 'hardware catalog', opts),
  images: (opts) => list('/images', 'images', opts, { q: opts.search }),
  nodes: (opts) => list('/nodes', 'instances', opts, { category: opts.category }),
  node(id, opts) {
    return detail('/node', 'instance detail', opts, { id: positiveInteger(id, 'node ID') });
  },

  async rent(opts) {
    const machineId = positiveInteger(opts.machine, 'machine ID');
    const imageId = positiveInteger(opts.image, 'image ID');
    const quantity = positiveInteger(opts.qty ?? '1', 'quantity');
    const envs = environment(opts.env);
    const machines = await spin('Fetching machines…', () => api.get('/machines'));
    const rows = extractList(responseData(machines));
    if (!rows) throw new Error('unrecognized machine list; the upstream API may have changed');
    const machine = rows.find((item) => item && String(item.id) === String(machineId));
    if (!machine) throw new Error(`machine ${machineId} not found - run: matpool machines`);
    const payload = {
      ...machine,
      imageId,
      hardware_qty: quantity,
      vnc_switcher: true,
      auto_password: true,
      c: opts.channel ?? loadConfig().channel ?? '',
    };
    if (opts.cmd !== undefined) payload.cmd = opts.cmd;
    if (envs !== undefined) payload.envs = envs;
    if (opts.dryRun) { json(payload); return; }
    await confirmAction(`Rent machine ${machineId} (quantity ${quantity}, image ${imageId})? This incurs charges.`, opts.yes);
    const res = await spin('Renting…', () => api.post('/node', payload));
    console.error('Rental request succeeded.');
    json(responseData(res));
  },

  async release(id, opts = {}) {
    const nodeId = positiveInteger(id, 'node ID');
    await confirmAction(`Release node ${nodeId}? Unsaved local data may be permanently lost.`, opts.yes);
    // Preserve the web API's string ID shape for DELETE.
    await spin(`Releasing node ${nodeId}…`, () => api.del('/node', { id: String(nodeId) }));
    console.error(`Node ${nodeId} released.`);
  },

  async stop(id, opts = {}) {
    const nodeId = positiveInteger(id, 'node ID');
    await confirmAction(`Request a temporary snapshot, then release node ${nodeId}? Snapshot completion is not verified; back up important data first.`, opts.yes);
    await spin('Requesting temporary snapshot…', () => api.post('/node/quick_save', { id: nodeId }));
    try {
      await spin(`Releasing node ${nodeId}…`, () => api.del('/node', { id: String(nodeId) }));
    } catch (err) {
      throw new Error(`snapshot request succeeded, but release failed: ${err.message}. Check matpool node ${nodeId}; billing may continue`, { cause: err });
    }
    console.error(`Node ${nodeId} released after snapshot request. Verify the temporary snapshot in the web console (nominal retention: 24h).`);
  },
};
