import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import pc from 'picocolors';

const CONFIG_PATH = process.env.MATPOOL_CONFIG
  || join(homedir(), '.config', 'matpool-cli', 'config.json');

// Hot reload: cache is keyed on file mtime, so edits from another process
// (or another terminal running `matpool login`) are picked up immediately.
let cache = { mtime: 0, data: {} };

export function loadConfig() {
  try {
    const mtime = statSync(CONFIG_PATH).mtimeMs;
    if (mtime !== cache.mtime) {
      cache = { mtime, data: JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {
    cache = { mtime: 0, data: {} };
  }
  return cache.data;
}

export function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
  cache = { mtime: statSync(CONFIG_PATH).mtimeMs, data: cfg };
}

export function getToken() {
  const cfg = loadConfig();
  if (!cfg.token) {
    die(`not logged in - run: ${pc.cyan('matpool login')}`);
  }
  return cfg.token;
}

export function die(msg, code = 1) {
  console.error(pc.red(`error: ${msg}`));
  process.exit(code);
}

export { pc };
