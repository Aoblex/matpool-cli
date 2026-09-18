import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CONFIG_PATH = process.env.MATPOOL_CONFIG
  || join(homedir(), '.config', 'matpool-cli', 'config.json');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
export { green, yellow };

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
}

export function getToken() {
  const cfg = loadConfig();
  if (!cfg.token) {
    die('not logged in, run: matpool login --name <username|phone> --password <password>');
  }
  return cfg.token;
}

export function die(msg, code = 1) {
  console.error(red(`error: ${msg}`));
  process.exit(code);
}
