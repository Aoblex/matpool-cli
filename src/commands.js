import readline from 'node:readline';
import Table from 'cli-table3';
import ora from 'ora';
import { api } from './client.js';
import { loadConfig, saveConfig, die, pc } from './config.js';

async function prompt(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(query, resolve));
  rl.close();
  return answer.trim();
}

async function promptHidden(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl._writeToOutput = (s) => rl.output.write(/^\r?\n?$/.test(s) ? s : '*');
  const answer = await new Promise((resolve) => rl.question(query, resolve));
  rl.close();
  console.log();
  return answer.trim();
}

// Wrap an async call with a spinner; the spinner stops on success or error
// (the caller handles errors - we rethrow).
async function spin(text, fn) {
  const spinner = ora(text).start();
  try {
    const result = await fn();
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

// Render a list of objects as a table. Picks a stable set of columns:
// known fields first (in a sensible order), then other primitive fields,
// capped to keep the table readable.
const PREFERRED_KEYS = [
  'id', 'name', 'status', 'state', 'gpu', 'gpu_type', 'gpuType', 'gpu_name',
  'price', 'hourPrice', 'pricePerHour', 'region', 'location', 'zone',
  'image', 'imageName', 'ssh', 'sshPort', 'port', 'createdAt', 'create_time',
  'expire', 'expiredAt', 'charged', 'machine', 'machine_id', 'category',
];
const MAX_COLS = 8;
const MAX_CELL = 28;

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return v.length > MAX_CELL ? v.slice(0, MAX_CELL - 1) + '…' : v;
}

export function renderTable(rows, asJson) {
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(pc.dim('(empty)'));
    return;
  }
  if (typeof rows[0] !== 'object' || rows[0] === null) {
    rows.forEach((r) => console.log(r));
    return;
  }

  const available = new Set();
  for (const row of rows.slice(0, 5)) {
    for (const [k, v] of Object.entries(row)) {
      if (v === null || typeof v !== 'object') available.add(k);
    }
  }
  const cols = [
    ...PREFERRED_KEYS.filter((k) => available.has(k)),
    ...[...available].filter((k) => !PREFERRED_KEYS.includes(k)),
  ].slice(0, MAX_COLS);

  const table = new Table({ head: cols.map((c) => pc.cyan(c)), style: { head: [] } });
  for (const row of rows) table.push(cols.map((c) => cell(row[c])));
  console.log(table.toString());
  console.log(pc.dim(`${rows.length} row(s), showing ${cols.length} column(s) - use --json for full data`));
}

function listResponse(data, asJson) {
  const rows = extractList(data);
  if (rows === null) {
    // Unexpected shape - fall back to raw JSON.
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  renderTable(rows, asJson);
}

export const commands = {
  async login(opts) {
    let name = opts.name || opts.mobile;
    if (!name && process.stdin.isTTY) name = await prompt('username or phone: ');
    if (!name) die('login requires a username or phone number');
    let password = opts.password || process.env.MATPOOL_PASSWORD;
    if (!password && process.stdin.isTTY) password = await promptHidden('password: ');
    if (!password) die('empty password');

    const body = /^1\d{10}$/.test(name) ? { mobile: name, password } : { name, password };
    const res = await spin('logging in…', () => api.post('/login', body));
    if (!res.token) die('login succeeded but no token returned');
    saveConfig({ ...loadConfig(), token: res.token });

    // The web client also sends an `x-matpool-user-id` header derived from GET /user.
    const info = await spin('fetching user info…', () => api.get('/user'));
    const id = info.data?.id ?? info.id;
    if (id) saveConfig({ ...loadConfig(), userId: id });
    console.log(pc.green(`✔ logged in as ${info.data?.name || name} (uid=${id})`));
  },

  async logout() {
    await api.post('/user/logout').catch(() => {});
    saveConfig({ ...loadConfig(), token: undefined, userId: undefined });
    console.log(pc.green('✔ logged out'));
  },

  async whoami(opts) {
    const res = await api.get('/user');
    if (opts.json) console.log(JSON.stringify(res.data, null, 2));
    else renderTable([res.data].filter(Boolean), false);
  },

  async balance(opts) {
    const res = await spin('fetching balance…', () => api.get('/user/account'));
    if (opts.json) console.log(JSON.stringify(res.data, null, 2));
    else renderTable([res.data].filter(Boolean), false);
  },

  async machines(opts) {
    const params = Object.fromEntries((opts.param || []).map((p) => {
      const i = p.indexOf('=');
      if (i <= 0) die(`invalid key=value pair: ${p}`);
      return [p.slice(0, i), p.slice(i + 1)];
    }));
    if (opts.category) params.category = opts.category;
    const res = await spin('fetching machines…', () => api.get('/machines', { params }));
    listResponse(res.data, opts.json);
  },

  async hardwares(opts) {
    const res = await spin('fetching hardware catalog…', () => api.get('/hardwares'));
    listResponse(res.data, opts.json);
  },

  async images(opts) {
    const params = {};
    if (opts.search) params.q = opts.search;
    const res = await spin('fetching images…', () => api.get('/images', { params }));
    listResponse(res.data, opts.json);
  },

  async nodes(opts) {
    const params = {};
    if (opts.category) params.category = opts.category;
    const res = await spin('fetching nodes…', () => api.get('/nodes', { params }));
    listResponse(res.data, opts.json);
  },

  async node(id, opts) {
    if (!id) die('node id is required');
    const res = await spin(`fetching node ${id}…`, () => api.get('/node', { params: { id } }));
    if (opts.json) console.log(JSON.stringify(res.data, null, 2));
    else renderTable([res.data].filter(Boolean), false);
  },

  async rent(opts) {
    if (!opts.machine) die('--machine <machine-id> is required (see: matpool machines)');
    if (!opts.image) die('--image <image-id> is required (see: matpool images)');

    const machines = await spin('fetching machines…', () => api.get('/machines'));
    const list = extractList(machines.data) || [];
    const machine = list.find((m) => String(m.id) === String(opts.machine));
    if (!machine) die(`machine ${opts.machine} not found - run: matpool machines`);

    // The web rent form spreads the selected machine object into the payload,
    // then adds image / runtime options on top.
    const payload = {
      ...machine,
      imageId: Number(opts.image),
      hardware_qty: Number(opts.qty || 1),
      vnc_switcher: true,
      auto_password: true,
      c: opts.channel || loadConfig().channel || '',
    };
    if (opts.cmd) payload.cmd = opts.cmd;
    if (opts.env) payload.envs = opts.env;

    if (opts.dryRun) {
      console.log(pc.yellow('dry run - payload that would be sent:'));
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    const res = await spin('renting…', () => api.post('/node', payload));
    console.log(pc.green('✔ rented successfully:'));
    console.log(JSON.stringify(res.data, null, 2));
  },

  async release(id) {
    if (!id) die('node id is required');
    await spin(`releasing node ${id}…`, () => api.del('/node', { id }));
    console.log(pc.green(`✔ node ${id} released`));
  },

  // "stop" on matpool = save a free 24h temp snapshot, then release the node.
  async stop(id) {
    if (!id) die('node id is required');
    await spin('creating temp snapshot…', () => api.post('/node/quick_save', { id: Number(id) }));
    await spin(`releasing node ${id}…`, () => api.del('/node', { id }));
    console.log(pc.green(`✔ node ${id} stopped (temp snapshot valid for 24h)`));
  },
};
