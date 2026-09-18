import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json' with { type: 'json' };
import { machine } from './fixtures.js';

const cli = fileURLToPath(new URL('../bin/matpool.js', import.meta.url));

async function fixture(t, handler) {
  const directory = mkdtempSync(join(tmpdir(), 'matpool-cli-test-'));
  const config = join(directory, 'config.json');
  writeFileSync(config, JSON.stringify({ token: 'test-token', userId: 1 }));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (handler) return handler(req, res);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.startsWith('/api/machine?')
      ? { code: 0, machine }
      : { code: 0, data: { items: [{ id: 1 }], total: 42 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    requests,
    run(args, overrides = {}) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], {
          env: { ...process.env, NO_COLOR: '1', MATPOOL_PASSWORD: '', MATPOOL_CONFIG: config,
            MATPOOL_API_BASE: `http://127.0.0.1:${server.address().port}/api`, MATPOOL_TIMEOUT_MS: '1000', ...overrides },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI test timed out')); }, 10_000);
        child.stdout.on('data', (data) => { stdout += data; });
        child.stderr.on('data', (data) => { stderr += data; });
        child.stdin.end();
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      });
    },
  };
}

test('CLI: help and version work without API requests', async (t) => {
  const { run, requests } = await fixture(t);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Unofficial CLI/);
  const version = await run(['--version']);
  assert.equal(version.stdout.trim(), pkg.version);
  assert.deepEqual(requests, []);
});

test('CLI: login and account reads support the current web API envelopes end to end', async (t) => {
  const { run, requests } = await fixture(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/login') {
      assert.equal(req.headers.authorization, undefined);
      res.end(JSON.stringify({ code: 0, token: 'new-token' }));
    } else if (req.url === '/api/user') {
      assert.equal(req.headers.authorization, 'Bearer new-token');
      res.end(JSON.stringify({ code: 0, user: { id: 456, name: 'user' }, services: {} }));
    } else if (req.url === '/api/user/account') {
      assert.equal(req.headers['x-matpool-user-id'], '456');
      res.end(JSON.stringify({ code: 0, account: { balance: 100 }, couponAmountYuan: 5 }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const login = await run(['login', '--name', 'user'], { MATPOOL_PASSWORD: 'fake-test-password' });
  assert.equal(login.code, 0, login.stderr);
  assert.match(login.stderr, /uid=456/);
  const whoami = await run(['whoami', '--json']);
  assert.equal(whoami.code, 0, whoami.stderr);
  assert.equal(JSON.parse(whoami.stdout).user.id, 456);
  const balance = await run(['balance', '--json']);
  assert.equal(balance.code, 0, balance.stderr);
  assert.equal(JSON.parse(balance.stdout).account.balance, 100);
  assert.deepEqual(requests, ['POST /api/login', 'GET /api/user', 'GET /api/user', 'GET /api/user/account']);
});

test('CLI: piped JSON is parseable and preserves metadata', async (t) => {
  const { run } = await fixture(t);
  const result = await run(['machines', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { items: [{ id: 1 }], total: 42 });
  assert.equal(result.stderr, '');
});

test('CLI: mutations refuse noninteractive execution without --yes', async (t) => {
  const { run, requests } = await fixture(t);
  for (const args of [['release', '12'], ['stop', '12'], ['rent', '-m', '1', '-i', '2']]) {
    const result = await run(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--yes/);
  }
  assert.ok(requests.every((request) => request.startsWith('GET ')));
});

test('CLI: release --yes performs DELETE and uses stderr for status', async (t) => {
  const { run, requests } = await fixture(t);
  const result = await run(['release', '12', '--yes']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Node 12 released/);
  assert.deepEqual(requests, ['DELETE /api/node']);
});

test('CLI: synchronous validation errors use concise central error handler', async (t) => {
  const { run, requests } = await fixture(t);
  const result = await run(['node', 'bad']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /error: node ID must be a positive integer/);
  assert.doesNotMatch(result.stderr, /at .*\.js:/);
  assert.deepEqual(requests, []);
});

test('CLI: timeout cancels a stalled response', async (t) => {
  const { run } = await fixture(t, () => {});
  const result = await run(['nodes', '--json'], { MATPOOL_TIMEOUT_MS: '50' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /request timed out/);
  assert.equal(result.stdout, '');
});

test('CLI: auth failure exits nonzero with login hint', async (t) => {
  const { run } = await fixture(t, (_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 176, msg: 'expired' }));
  });
  const result = await run(['whoami', '--json']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /run: matpool login/);
});
