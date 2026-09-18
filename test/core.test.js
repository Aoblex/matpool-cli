import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig } from '../src/config.js';
import { api, ApiError } from '../src/client.js';
import { commands, positiveInteger, queryParams } from '../src/commands.js';
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
  respond(t, [{ code: 0, data: [{ id: 1, machine_category: 'gpu' }] }]);
  await commands.rent({ machine: '1', image: '2', qty: '3', env: '{"KEY":"value"}', dryRun: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(output.join('\n')), {
    id: 1, machine_category: 'gpu', imageId: 2, hardware_qty: 3,
    vnc_switcher: true, auto_password: true, c: 'test', envs: '{"KEY":"value"}',
  });
});

test('rent: --yes submits the previewed payload', async (t) => {
  loggedIn();
  respond(t, [{ data: [{ id: 1 }] }, { data: { id: 88 } }]);
  await commands.rent({ machine: '1', image: '2', yes: true });
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url.pathname, '/api/node');
  assert.equal(JSON.parse(calls[1].body).imageId, 2);
  assert.deepEqual(JSON.parse(output[0]), { id: 88 });
});

test('release/stop: invalid IDs never reach API', async () => {
  await assert.rejects(commands.release('abc', { yes: true }), /positive/);
  await assert.rejects(commands.stop('-1', { yes: true }), /positive/);
  assert.equal(calls.length, 0);
});

test('stop: failed snapshot never releases node', async (t) => {
  loggedIn();
  respond(t, [{ code: 9, msg: 'snapshot failed' }]);
  await assert.rejects(commands.stop('12', { yes: true }), /snapshot failed/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/api/node/quick_save');
});

test('stop: release failure explains partial success and continued billing', async (t) => {
  loggedIn();
  respond(t, [{ code: 0 }, { code: 9, msg: 'release failed' }]);
  await assert.rejects(commands.stop('12', { yes: true }), /snapshot request succeeded.*billing may continue/);
  assert.equal(calls[1].method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[1].body), { id: '12' });
});

test('stop: requests snapshot before release and reports uncertainty honestly', async (t) => {
  loggedIn();
  respond(t, [{ code: 0 }, { code: 0 }]);
  await commands.stop('12', { yes: true });
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'DELETE']);
  assert.match(errors.join('\n'), /Verify the temporary snapshot/);
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
  await commands.machines({ param: ['category=old'], category: 'new', json: true });
  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/user', '/api/user/account', '/api/node', '/api/images', '/api/hardwares', '/api/machines',
  ]);
  assert.equal(calls[2].url.searchParams.get('id'), '12');
  assert.equal(calls[3].url.searchParams.get('q'), 'pytorch & cuda');
  assert.equal(calls[5].url.searchParams.get('category'), 'new');
  for (const line of output) assert.deepEqual(JSON.parse(line), { id: 1, nested: { value: true } });
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
