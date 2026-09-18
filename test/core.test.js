import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig } from '../src/config.js';
import { api, ApiError } from '../src/client.js';
import { commands, positiveInteger, queryParams } from '../src/commands.js';
import { machine, userNode } from './fixtures.js';
import { extractList, renderTable, detailResponse, loginInput } from '../src/ui.js';

let directory;
let calls;
let output;
let errors;
let env;

beforeEach((t) => {
  env = { ...process.env };
  directory = mkdtempSync(join(tmpdir(), 'matpool-test-'));
  process.env.MATPOOL_CONFIG = join(directory, 'config.json');
  process.env.MATPOOL_API_BASE = 'https://example.invalid/api/';
  delete process.env.MATPOOL_PASSWORD;
  delete process.env.MATPOOL_TIMEOUT_MS;
  calls = [];
  output = [];
  errors = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  // Fail closed: no test may accidentally contact the real API.
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    throw new Error('unexpected fetch');
  });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

function respond(t, responses) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    assert.ok(responses.length, 'unexpected extra API request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json({ code: 0, ...response });
  });
}

function loggedIn() { saveConfig({ token: 'old-token', userId: 123, channel: 'test' }); }

test('config: missing file is empty; writes are private, complete, and replaceable', () => {
  assert.deepEqual(loadConfig(), {});
  loggedIn();
  assert.equal(loadConfig().token, 'old-token');
  if (process.platform !== 'win32') assert.equal(statSync(process.env.MATPOOL_CONFIG).mode & 0o777, 0o600);
  saveConfig({ token: 'new-token' });
  assert.deepEqual(loadConfig(), { token: 'new-token' });
  assert.deepEqual(readdirSync(directory), ['config.json']);
});

test('config: corrupt files and invalid shapes are not silently ignored', () => {
  for (const text of ['{', 'null', '[]', '{"token":42}']) {
    writeFileSync(process.env.MATPOOL_CONFIG, text);
    assert.throws(loadConfig, /config/);
  }
});

test('client: authenticated requests require credentials before networking', async () => {
  await assert.rejects(api.get('/user'), /not logged in/);
  assert.equal(calls.length, 0);
});

test('client: headers, query encoding, trailing slash and timeout', async (t) => {
  loggedIn();
  respond(t, [{ code: 0, data: {} }]);
  await api.get('/machines', { params: { q: 'a & b', omitted: undefined } });
  assert.equal(calls[0].url.pathname, '/api/machines');
  assert.equal(calls[0].url.searchParams.get('q'), 'a & b');
  assert.equal(calls[0].url.searchParams.has('omitted'), false);
  assert.equal(calls[0].headers.Authorization, 'Bearer old-token');
  assert.equal(calls[0].headers['x-matpool-user-id'], '123');
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].redirect, 'error');
});

test('client: handles business, HTTP, invalid JSON and null responses', async (t) => {
  loggedIn();
  respond(t, [
    { code: 7, msg: 'expired' },
    Response.json({ msg: 'unavailable' }, { status: 503 }),
    new Response('<html>secret</html>', { status: 502 }),
    Response.json(null, { status: 500 }),
  ]);
  await assert.rejects(api.get('/user'), (err) => err instanceof ApiError && err.code === 7);
  await assert.rejects(api.get('/user'), /unavailable/);
  await assert.rejects(api.get('/user'), /expected a JSON response \(HTTP 502\)/);
  await assert.rejects(api.get('/user'), /invalid API response \(HTTP 500\)/);
});

test('client: missing or string status codes are never treated as mutation success', async (t) => {
  loggedIn();
  respond(t, [Response.json({}), Response.json({ code: '7' })]);
  await assert.rejects(api.del('/node', { id: '1' }), /numeric status code/);
  await assert.rejects(api.del('/node', { id: '1' }), /numeric status code/);
});

test('client: timeouts and network errors are actionable and never retried', async (t) => {
  loggedIn();
  respond(t, [new DOMException('timeout', 'TimeoutError'), new TypeError('fetch failed', { cause: new Error('offline') })]);
  await assert.rejects(api.post('/node', {}), /check instance state before retrying/);
  await assert.rejects(api.get('/user'), /network error: offline/);
  assert.equal(calls.length, 2);
});

test('client: invalid timeout is rejected before fetch', async () => {
  loggedIn();
  process.env.MATPOOL_TIMEOUT_MS = '-1';
  await assert.rejects(api.get('/user'), /MATPOOL_TIMEOUT_MS/);
  assert.equal(calls.length, 0);
});

test('login: credentials are isolated and persisted only after user lookup succeeds', async (t) => {
  loggedIn();
  respond(t, [{ code: 0, token: 'new-token' }, { code: 0, data: { id: 456 } }]);
  await commands.login({ name: 'other-user', password: ' spaced password ' });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers['x-matpool-user-id'], undefined);
  assert.equal(JSON.parse(calls[0].body).password, ' spaced password ');
  assert.equal(calls[1].headers.Authorization, 'Bearer new-token');
  assert.equal(calls[1].headers['x-matpool-user-id'], undefined);
  assert.deepEqual(loadConfig(), { token: 'new-token', userId: 456, channel: 'test' });
});

test('login: failed lookup leaves old credentials untouched', async (t) => {
  loggedIn();
  const original = readFileSync(process.env.MATPOOL_CONFIG, 'utf8');
  respond(t, [{ token: 'new-token' }, { code: 7, msg: 'failed' }]);
  await assert.rejects(commands.login({ name: '13800000000', password: 'secret' }), /failed/);
  assert.deepEqual(JSON.parse(calls[0].body), { mobile: '13800000000', password: 'secret' });
  assert.equal(readFileSync(process.env.MATPOOL_CONFIG, 'utf8'), original);
});

test('login: missing token or user ID never replaces valid credentials', async (t) => {
  loggedIn();
  respond(t, [{}, { token: 'new-token' }, { data: {} }]);
  await assert.rejects(commands.login({ name: 'user', password: 'secret' }), /did not contain a token/);
  await assert.rejects(commands.login({ name: 'user', password: 'secret' }), /user ID/);
  assert.equal(loadConfig().token, 'old-token');
  assert.equal(loadConfig().userId, 123);
});

// Confirmed in the public web client's fetchUserInfo action: it destructures
// {user, code, services, ...rest}, then reads user.id for the request header.
test('login: current web API user envelope persists ID and authenticates follow-up reads', async (t) => {
  loggedIn();
  respond(t, [
    { token: 'new-token' },
    { user: { id: 456, name: 'user' }, services: {}, registerableDomains: [] },
    { user: { id: 456, name: 'user' }, services: {} },
  ]);
  await commands.login({ name: 'user', password: 'secret' });
  assert.deepEqual(loadConfig(), { token: 'new-token', userId: 456, channel: 'test' });
  await commands.whoami({ json: true });
  assert.equal(calls.at(-1).headers['x-matpool-user-id'], '456');
  assert.deepEqual(JSON.parse(output[0]), { user: { id: 456, name: 'user' }, services: {} });
});

test('login: opaque string user IDs are preserved in config and subsequent headers', async (t) => {
  for (const id of ['user-8d343fc0', '900719925474099312345', '000123']) {
    respond(t, [{ token: 'new-token' }, { data: { id } }, { data: {} }]);
    await commands.login({ name: 'user', password: 'secret' });
    assert.equal(loadConfig().userId, id);
    await api.get('/user/account');
    assert.equal(calls.at(-1).headers['x-matpool-user-id'], id);
  }
});

test('login: falls back to root ID even when data exists without an ID', async (t) => {
  respond(t, [{ token: 'new-token' }, { data: { name: 'user' }, id: 'root-user-id' }]);
  await commands.login({ name: 'user', password: 'secret' });
  assert.equal(loadConfig().userId, 'root-user-id');
});

test('login: unusable user IDs leave existing credentials unchanged', async (t) => {
  loggedIn();
  for (const id of ['', ' ', {}, [], 'bad\r\nheader', 9007199254740992]) {
    respond(t, [{ token: 'new-token' }, { data: { id } }]);
    await assert.rejects(commands.login({ name: 'user', password: 'secret' }), /no usable user ID/);
    assert.equal(loadConfig().token, 'old-token');
  }
});

test('login: environment passwords preserve whitespace', async () => {
  process.env.MATPOOL_PASSWORD = ' secret ';
  assert.deepEqual(await loginInput({ name: ' user ' }), { name: 'user', password: ' secret ' });
});

test('logout: clears local credentials before contacting remote server', async (t) => {
  loggedIn();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(loadConfig(), { channel: 'test' });
    assert.equal(options.headers.Authorization, 'Bearer old-token');
    throw new Error('offline');
  });
  await commands.logout();
  assert.deepEqual(loadConfig(), { channel: 'test' });
  assert.match(errors.join('\n'), /remote session could not be invalidated/);
});

test('validation: positive safe integers and query values containing equals', () => {
  for (const input of ['0', '-1', '1.5', 'abc', '1e3', '', '9007199254740992']) {
    assert.throws(() => positiveInteger(input, 'ID'), /positive/);
  }
  assert.equal(positiveInteger('42', 'ID'), 42);
  assert.deepEqual(queryParams(['q=a=b', 'q=last', 'empty=']), { q: 'last', empty: '' });
  assert.throws(() => queryParams(['=bad']), /invalid/);
});

test('rent: invalid arguments fail before any network request', async () => {
  for (const opts of [{ image: 'abc' }, { qty: '-2' }, { env: '{bad' }]) {
    await assert.rejects(commands.rent({ machine: '1', image: '2', ...opts }));
  }
  assert.equal(calls.length, 0);
});

test('rent: dry-run emits only a complete JSON payload, with no mutation', async (t) => {
  loggedIn();
  respond(t, [{ machine }]);
  await commands.rent({ machine: '1', image: '2', qty: '3', env: 'KEY=value;OTHER=a=b', dryRun: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/api/machine');
  assert.equal(calls[0].url.searchParams.get('agent_id'), '1');
  assert.deepEqual(JSON.parse(output.join('\n')), {
    agent_id: 1, machine_category: 0, image_id: 2, hardware_qty: 3,
    vnc_switcher: true, auto_password: true, c: 'test', envs: 'KEY=value;OTHER=a=b',
  });
});

test('rent: --yes submits the previewed payload', async (t) => {
  loggedIn();
  respond(t, [{ machine }, { code: 0 }]);
  await commands.rent({ machine: '1', image: '2', yes: true });
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url.pathname, '/api/node');
  assert.equal(JSON.parse(calls[1].body).image_id, 2);
  assert.deepEqual(JSON.parse(output[0]), { code: 0 });
});

test('release/stop: invalid IDs never reach API', async () => {
  await assert.rejects(commands.release('abc', { yes: true }), /positive/);
  await assert.rejects(commands.stop('-1', { yes: true }), /positive/);
  assert.equal(calls.length, 0);
});

test('stop: failed snapshot never releases node', async (t) => {
  loggedIn();
  respond(t, [{ userNode }, { userNodes: [userNode] }, { code: 9, msg: 'snapshot failed' }]);
  await assert.rejects(commands.stop('12', { yes: true }), /snapshot failed/);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST']);
  assert.equal(calls[2].url.pathname, '/api/node/quick_save');
});

test('stop: unsupported snapshots fail without any mutation', async (t) => {
  loggedIn();
  respond(t, [{ userNode }, { userNodes: [{ ...userNode, supportQuickSave: false }] }]);
  await assert.rejects(commands.stop('12', { yes: true }), /does not support/);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET']);
});

test('stop: missing request identity prevents any mutation', async (t) => {
  loggedIn();
  respond(t, [{ userNode: { ...userNode, displayID: '' } }]);
  await assert.rejects(commands.stop('12', { yes: true }), /displayID/);
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
});

test('release: uses the numeric instance ID expected by the web client', async (t) => {
  loggedIn();
  respond(t, [{ code: 0 }]);
  await commands.release('12', { yes: true });
  assert.deepEqual(JSON.parse(calls[0].body), { id: 12 });
  assert.equal(calls[0].method, 'DELETE');
});

test('stop: server coordinates saving and stopping; CLI never sends DELETE', async (t) => {
  loggedIn();
  respond(t, [{ userNode }, { userNodes: [userNode] }, { code: 0 }]);
  await commands.stop('12', { yes: true });
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'POST']);
  assert.deepEqual(JSON.parse(calls[2].body), { request_id: userNode.displayID, cancel_node: true });
  assert.match(errors.join('\n'), /Completion is pending/);
  assert.doesNotMatch(errors.join('\n'), /released/);
});

test('stop: live API regression - list capability overrides false in detail', async (t) => {
  loggedIn();
  respond(t, [{ userNode: { ...userNode, supportQuickSave: false } }, { userNodes: [userNode] }, { code: 0 }]);
  await commands.stop('12', { yes: true });
  assert.equal(calls[1].url.pathname, '/api/nodes');
  assert.equal(calls[1].url.searchParams.get('keywords'), userNode.displayID);
  assert.equal(calls[1].url.searchParams.get('order'), 'false');
  assert.deepEqual(JSON.parse(calls[2].body), { request_id: userNode.displayID, cancel_node: true });
});

test('stop: fuzzy search results cannot authorize stopping a different instance', async (t) => {
  loggedIn();
  for (const other of [{ ...userNode, node: { id: 99 } }, { ...userNode, displayID: 'other-request' }]) {
    respond(t, [{ userNode }, { userNodes: [other] }]);
    await assert.rejects(commands.stop('12', { yes: true }), /could not verify/);
  }
  assert.ok(calls.every((call) => call.method === 'GET'));
});

test('lists: --json preserves pagination metadata and all fields', async (t) => {
  loggedIn();
  const data = { items: [{ id: 1, nested: { full: true } }], total: 42 };
  respond(t, [{ code: 0, data }]);
  await commands.machines({ json: true });
  assert.deepEqual(JSON.parse(output.join('\n')), data);
});

test('read commands: paths, filters, and detail data remain consistent', async (t) => {
  loggedIn();
  respond(t, Array.from({ length: 6 }, () => ({ data: { id: 1, nested: { value: true } } })));
  await commands.whoami({ json: true });
  await commands.balance({ json: true });
  await commands.node('12', { json: true });
  await commands.images({ search: 'pytorch & cuda', json: true });
  await commands.hardwares({ json: true });
  await commands.machines({ param: ['machine_category=0'], category: 'cpu', json: true });
  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/user', '/api/user/account', '/api/node', '/api/images', '/api/hardwares', '/api/machines',
  ]);
  assert.equal(calls[2].url.searchParams.get('id'), '12');
  assert.equal(calls[3].url.searchParams.get('keywords'), '["pytorch","&","cuda"]');
  assert.equal(calls[5].url.searchParams.get('machine_category'), '1');
  for (const line of output) assert.deepEqual(JSON.parse(line), { id: 1, nested: { value: true } });
});

test('read commands: top-level API fields are preserved without requiring a data wrapper', async (t) => {
  loggedIn();
  const account = { account: { balance: 100, expense: { amount: 20, timeSec: 60 } }, couponAmountYuan: 5 };
  const machines = { machines: [{ id: 1 }], total: 42 };
  respond(t, [account, machines]);
  await commands.balance({ json: true });
  await commands.machines({ json: true });
  assert.deepEqual(JSON.parse(output[0]), account);
  assert.deepEqual(JSON.parse(output[1]), machines);
});

test('rent: excessive quantity fails before a mutation', async (t) => {
  loggedIn();
  respond(t, [{ machine }]);
  await assert.rejects(commands.rent({ machine: '1', image: '2', qty: '5', yes: true }), /availability/);
  assert.equal(calls.length, 1);
});

test('rent: CPU and NPU categories follow the hardware rather than a guessed GPU default', async (t) => {
  loggedIn();
  for (const [category, hardware] of [
    [1, { gpu: { gpuIds: null }, machine: { cpuName: 'Test CPU' } }],
    [3, { npu: { npuIds: [0] }, machine: { cpuName: 'Test CPU' } }],
  ]) {
    respond(t, [{ machine: { ...machine, hardware } }]);
    await commands.rent({ machine: '1', image: '2', dryRun: true });
    assert.equal(JSON.parse(output.at(-1)).machine_category, category);
  }
});

test('rent: physical GPU limits are converted to allocation units', async (t) => {
  loggedIn();
  respond(t, [{ machine: { ...machine, gpu: { available: 8, total: 8, max: 4 } } }]);
  await assert.rejects(commands.rent({ machine: '1', image: '2', qty: '3', yes: true }), /per-instance limit/);
  assert.equal(calls.length, 1);
});

test('lists: invalid paging/category fails before network requests', async () => {
  await assert.rejects(commands.nodes({ page: '0' }), /page/);
  await assert.rejects(commands.images({ perPage: '-1' }), /per-page/);
  assert.throws(() => commands.machines({ category: 'unknown' }), /category/);
  assert.equal(calls.length, 0);
});

test('lists: all list endpoints send mandatory pagination; explicit options take precedence', async (t) => {
  loggedIn();
  respond(t, Array.from({ length: 5 }, () => ({ data: [] })));
  for (const command of ['machines', 'hardwares', 'images', 'nodes']) await commands[command]({ json: true });
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('page'), '1');
    assert.equal(call.url.searchParams.get('per_page'), '20');
  }
  await commands.machines({ param: ['page=3', 'per_page=10'], page: '2', perPage: '5', json: true });
  assert.equal(calls.at(-1).url.searchParams.get('page'), '2');
  assert.equal(calls.at(-1).url.searchParams.get('per_page'), '5');
});

test('human output: nested identities are visible while secrets are excluded', async (t) => {
  loggedIn();
  respond(t, [
    { user: { id: 1, name: 'user', password: 'fixture-secret' }, services: { authToken: 'fixture-secret' } },
    { userNode }, { userNodes: [userNode] }, { machines: [machine] },
  ]);
  await commands.whoami({});
  await commands.node('12', {});
  await commands.nodes({});
  await commands.machines({});
  assert.doesNotMatch(output.join('\n'), /fixture-secret/);
  assert.match(output[1], /id: 12/);
  assert.match(output[2], /12/);
  assert.match(output[3], /agentId/);
});

test('lists: missing data is an error rather than undefined output', async (t) => {
  loggedIn();
  respond(t, [{ code: 0 }]);
  await assert.rejects(commands.nodes({ json: true }), /missing data/);
});

test('rendering: prefers known list keys, avoids ambiguous arrays, handles heterogeneous rows', () => {
  assert.deepEqual(extractList({ tags: [1], items: [2] }), [2]);
  assert.equal(extractList({ a: [1], b: [2] }), null);
  renderTable([{ id: 1 }, null]);
  assert.deepEqual(JSON.parse(output[0]), [{ id: 1 }, null]);
  renderTable([{ id: 1, nested: { value: true } }]);
  assert.match(output[1], /nested/);
});

test('detail: preserves long values and nested data; table output neutralizes controls', () => {
  const value = 'a'.repeat(80);
  detailResponse({ ssh: value, nested: { port: 22 } }, false);
  assert.match(output[0].replace(/[^a]/g, ''), new RegExp(`a{${value.length}}`));
  renderTable([{ name: '\u001b[2Junsafe' }]);
  assert.ok(!output[1].includes('\u001b[2J'));
});
