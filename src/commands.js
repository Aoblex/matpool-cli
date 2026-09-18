import { api } from './client.js';
import { loadConfig, saveConfig } from './config.js';
import { loginInput, confirmAction, spin, json, extractList, renderTable, detailResponse } from './ui.js';
import { userSummary, nodeSummary, listViews } from './views.js';

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
  if (Object.hasOwn(res, 'data')) return res.data;
  // /api is not a uniform {code, data} API. The web client reads named
  // top-level fields, e.g. /user -> user and /user/account -> account.
  const payload = Object.fromEntries(Object.entries(res).filter(([key]) => !['code', 'msg'].includes(key)));
  if (!Object.keys(payload).length) throw new Error('API response is missing data; the upstream API may have changed');
  return payload;
}

function environment(value) {
  if (value === undefined || value === '') return value;
  if (value.split(';').some((entry) => !/^[A-Za-z_][A-Za-z0-9_]*=[^\r\n\0]*$/.test(entry))) {
    throw new Error('--env must use KEY=value;KEY2=value syntax (not JSON)');
  }
  return value;
}

export function machineCategory(value = 'gpu') {
  const category = { gpu: 0, cpu: 1, npu: 3 }[value] ?? Number(value);
  if (![0, 1, 3].includes(category) || String(value).trim() === '') {
    throw new Error('category must be gpu (0), cpu (1), or npu (3)');
  }
  return category;
}

function pagination(opts, params = {}) {
  return { ...params,
    page: positiveInteger(opts.page ?? params.page ?? 1, 'page'),
    per_page: positiveInteger(opts.perPage ?? params.per_page ?? 20, 'per-page') };
}

async function list(path, label, key, opts, params = {}) {
  const res = await spin(`Fetching ${label}…`, () => api.get(path, { params: pagination(opts, params) }));
  const data = responseData(res);
  if (opts.json) { json(data); return; }
  const rows = data?.[key] ?? extractList(data);
  if (!Array.isArray(rows)) throw new Error(`unrecognized ${label} list; use --json to inspect the response`);
  renderTable(rows.map(listViews[key]));
  const page = data?.pagination;
  if (page) console.error(`Page ${page.page}/${page.numPages}; ${page.total} total. Use --page and --per-page to browse.`);
}

async function detail(path, label, opts, params = {}, summarize = (data) => data) {
  const res = await spin(`Fetching ${label}…`, () => api.get(path, { params }));
  const data = responseData(res);
  detailResponse(opts.json ? data : summarize(data), opts.json);
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
    // User IDs are opaque header values, not quantities. Preserve string IDs
    // (including UUIDs and large numeric strings) without number conversion.
    const id = info.user?.id ?? info.data?.id ?? info.id;
    const validString = typeof id === 'string' && id.trim().length > 0 && !/[\r\n]/.test(id);
    if (!validString && !(typeof id === 'number' && Number.isSafeInteger(id))) {
      throw new Error('user info response has no usable user ID (expected user.id, data.id or id); credentials were not changed');
    }
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

  whoami: (opts) => detail('/user', 'user info', opts, {}, userSummary),
  balance: (opts) => detail('/user/account', 'balance', opts),
  machines(opts) {
    const params = queryParams(opts.param);
    params.machine_category = machineCategory(opts.category ?? params.machine_category);
    return list('/machines', 'machines', 'machines', opts, params);
  },
  hardwares: (opts) => list('/hardwares', 'hardware catalog', 'hardwares', opts,
    { machine_category: machineCategory(opts.category) }),
  images: (opts) => list('/images', 'images', 'images', opts, {
    machine_category: machineCategory(opts.category),
    agent_id: opts.machine === undefined ? undefined : positiveInteger(opts.machine, 'agent ID'),
    keywords: opts.search?.trim() ? JSON.stringify(opts.search.trim().split(/\s+/)) : undefined,
  }),
  nodes: (opts) => list('/nodes', 'instances', 'userNodes', opts),
  node(id, opts) {
    return detail('/node', 'instance detail', opts, { id: positiveInteger(id, 'node ID') }, nodeSummary);
  },

  async rent(opts) {
    const machineId = positiveInteger(opts.machine, 'machine ID');
    const imageId = positiveInteger(opts.image, 'image ID');
    const quantity = positiveInteger(opts.qty ?? '1', 'quantity');
    const envs = environment(opts.env);
    const result = await spin('Fetching machine…', () => api.get('/machine', { params: { agent_id: machineId } }));
    const machine = responseData(result).machine;
    if (!machine || machine.agentId !== machineId || !machine.hardware) {
      throw new Error('unrecognized machine response; expected machine.agentId and machine.hardware');
    }
    // Mirrors the web client's hardware category and getRentParams helpers.
    const category = machine.hardware.npu?.npuIds?.length ? 3 : machine.hardware.gpu?.gpuIds?.length ? 0 : 1;
    const capacity = machine[{ 0: 'gpu', 1: 'cpu', 3: 'npu' }[category]];
    // hardware_qty counts allocation units, not physical GPUs/CPU cores.
    const unitStep = capacity?.total / machine.unit?.total;
    const available = machine.unit?.available;
    const limit = capacity?.max > 0 && unitStep > 0 ? Math.floor(capacity.max / unitStep) : available;
    if ((Number.isFinite(available) && quantity > available) || (Number.isFinite(limit) && quantity > limit)) {
      throw new Error('requested quantity exceeds machine availability or per-instance limit');
    }
    const payload = {
      agent_id: machineId,
      image_id: imageId,
      machine_category: category,
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
    // A successful creation can be a status-only acknowledgment. Do not report
    // failure and encourage an accidental duplicate rental just because data is absent.
    json(res);
  },

  async release(id, opts = {}) {
    const nodeId = positiveInteger(id, 'node ID');
    await confirmAction(`Release node ${nodeId}? Unsaved local data may be permanently lost.`, opts.yes);
    await spin(`Releasing node ${nodeId}…`, () => api.del('/node', { id: nodeId }));
    console.error(`Node ${nodeId} released.`);
  },

  async stop(id, opts = {}) {
    const nodeId = positiveInteger(id, 'node ID');
    await confirmAction(`Ask the server to save and stop node ${nodeId}? If saving fails, it may keep running and billing.`, opts.yes);
    const result = await spin('Fetching instance…', () => api.get('/node', { params: { id: nodeId } }));
    const instance = responseData(result).userNode;
    if (instance?.node?.id !== nodeId || !instance.displayID) throw new Error('instance response is missing the matching node or displayID');
    if (instance.supportQuickSave !== true) throw new Error('this instance does not support temporary snapshots; no stop was requested');
    // The backend coordinates snapshot completion and stopping. Never issue a
    // separate DELETE: an acknowledged snapshot request is not a finished backup.
    await spin('Requesting save and stop…', () => api.post('/node/quick_save', {
      request_id: instance.displayID, cancel_node: true,
    }));
    console.error(`Save-and-stop request accepted for node ${nodeId}. Completion is pending; check its state in the web console. Billing may continue if saving fails.`);
  },
};
