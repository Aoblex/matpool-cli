import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import pc from 'picocolors';

function configPath() {
  return process.env.MATPOOL_CONFIG || join(homedir(), '.config', 'matpool-cli', 'config.json');
}

export function loadConfig() {
  let text;
  try {
    text = readFileSync(configPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`cannot read config: ${err.message}`, { cause: err });
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    throw new Error(`invalid JSON in config: ${configPath()}`);
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new Error(`config must be a JSON object: ${configPath()}`);
  }
  if (cfg.token !== undefined && (typeof cfg.token !== 'string' || !cfg.token)) {
    throw new Error('config token must be a non-empty string');
  }
  return cfg;
}

// Write privately from the start, then replace atomically so readers never see
// partial JSON. No cache: this CLI's config is tiny and credentials may change.
export function saveConfig(cfg) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch (err) {
    try { unlinkSync(temporary); } catch { /* Best effort; preserve the original write error. */ }
    throw err;
  }
}

export { pc };
