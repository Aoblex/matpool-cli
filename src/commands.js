import readline from 'node:readline';
import { api } from './client.js';
import { loadConfig, saveConfig, die, green, yellow } from './config.js';

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

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

function parseKV(pairs = []) {
  const obj = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i <= 0) die(`invalid key=value pair: ${p}`);
    obj[p.slice(0, i)] = p.slice(i + 1);
  }
  return obj;
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
    const res = await api.post('/login', body);
    if (!res.token) die('login succeeded but no token returned');
    saveConfig({ ...loadConfig(), token: res.token });

    // The web client also sends an `x-matpool-user-id` header derived from GET /user.
    const info = await api.get('/user');
    const id = info.data?.id ?? info.id;
    if (id) saveConfig({ ...loadConfig(), userId: id });
    console.log(green(`logged in as ${info.data?.name || name} (uid=${id})`));
  },

  async logout() {
    await api.post('/user/logout').catch(() => {});
    saveConfig({ ...loadConfig(), token: undefined, userId: undefined });
    console.log(green('logged out'));
  },

  async whoami() {
    print((await api.get('/user')).data);
  },

  async balance() {
    print((await api.get('/user/account')).data);
  },

  async machines(opts) {
    const params = parseKV(opts.param);
    if (opts.category) params.category = opts.category;
    print((await api.get('/machines', { params })).data);
  },

  async hardwares() {
    print((await api.get('/hardwares')).data);
  },

  async images(opts) {
    const params = parseKV(opts.param);
    if (opts.search) params.q = opts.search;
    print((await api.get('/images', { params })).data);
  },

  async nodes(opts) {
    const params = parseKV(opts.param);
    if (opts.category) params.category = opts.category;
    print((await api.get('/nodes', { params })).data);
  },

  async node(id) {
    if (!id) die('usage: matpool node <id>');
    print((await api.get('/node', { params: { id } })).data);
  },

  async rent(opts) {
    const machineId = opts.machine;
    if (!machineId) die('usage: matpool rent --machine <machine-id> --image <image-id> [options]');
    if (!opts.image) die('rent requires --image <image-id> (see: matpool images)');

    const machines = (await api.get('/machines')).data;
    const list = Array.isArray(machines) ? machines : (machines?.list || machines?.machines || []);
    const machine = list.find((m) => String(m.id) === String(machineId));
    if (!machine) die(`machine ${machineId} not found in /machines output`);

    // The web rent form spreads the selected machine object into the payload,
    // then adds image / runtime options on top.
    const payload = {
      ...machine,
      imageId: Number(opts.image),
      hardware_qty: Number(opts.qty || 1),
      vnc_switcher: true,
      auto_password: true,
      c: loadConfig().channel || '',
    };
    if (opts.cmd) payload.cmd = opts.cmd;
    if (opts.env) payload.envs = opts.env;
    if (opts.channel) payload.c = opts.channel;

    if (opts.dryRun) {
      console.log(yellow('dry run - payload that would be sent:'));
      print(payload);
      return;
    }
    const res = await api.post('/node', payload);
    console.log(green('rented successfully:'));
    print(res.data);
  },

  async release(id) {
    if (!id) die('usage: matpool release <node-id>');
    await api.del('/node', { id });
    console.log(green(`node ${id} released`));
  },

  // "stop" on matpool = save a free 24h temp snapshot, then release the node.
  async stop(id) {
    if (!id) die('usage: matpool stop <node-id>');
    await api.post('/node/quick_save', { id: Number(id) });
    console.log('temp snapshot created, releasing node...');
    await api.del('/node', { id });
    console.log(green(`node ${id} stopped`));
  },
};
