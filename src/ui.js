import { input, password, confirm } from '@inquirer/prompts';
import Table from 'cli-table3';
import ora from 'ora';
import { pc } from './config.js';

const interactive = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);
const promptOptions = { output: process.stderr };

async function ask(fn, options) {
  try {
    return await fn(options, promptOptions);
  } catch (err) {
    if (err.name === 'ExitPromptError') throw new Error('cancelled', { cause: err });
    throw err;
  }
}

export async function loginInput(opts) {
  let name = opts.name?.trim();
  if (!name && interactive()) name = (await ask(input, { message: 'Username or phone:' })).trim();
  if (!name) throw new Error('login requires --name <username or phone>');
  let secret = opts.password ?? process.env.MATPOOL_PASSWORD;
  if (secret === undefined && interactive()) secret = await ask(password, { message: 'Password:', mask: '*' });
  if (!secret) throw new Error('empty password; use the interactive prompt or MATPOOL_PASSWORD');
  return { name, password: secret };
}

export async function confirmAction(message, yes) {
  if (yes) return;
  if (!interactive()) throw new Error('this action requires confirmation; use --yes in non-interactive mode');
  if (!await ask(confirm, { message, default: false })) throw new Error('cancelled');
}

export async function spin(text, fn) {
  // Keep pipelines and --json quiet. Human status messages go to stderr only.
  const spinner = process.stderr.isTTY ? ora({ text, stream: process.stderr }).start() : null;
  try {
    const result = await fn();
    spinner?.succeed();
    return result;
  } catch (err) {
    spinner?.fail();
    throw err;
  }
}

export function json(value) {
  console.log(JSON.stringify(value ?? null, null, 2));
}

const PREFERRED_KEYS = ['id', 'name', 'status', 'state', 'gpu', 'gpu_type', 'gpuType', 'gpu_name',
  'price', 'hourPrice', 'pricePerHour', 'region', 'location', 'zone', 'image', 'imageName',
  'ssh', 'sshPort', 'port', 'createdAt', 'create_time', 'expire', 'expiredAt', 'charged',
  'machine', 'machine_id', 'category'];

export function extractList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  // Prefer known list fields; don't guess if several unknown arrays are present.
  for (const key of ['items', 'list', 'rows', 'records']) {
    if (Array.isArray(data[key])) return data[key];
  }
  const arrays = Object.values(data).filter(Array.isArray);
  return arrays.length === 1 ? arrays[0] : null;
}

function cell(value, truncate = false) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // API-controlled strings must not emit terminal control sequences.
  // eslint-disable-next-line no-control-regex -- deliberately remove terminal controls
  const safe = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  const chars = [...safe];
  return truncate && chars.length > 36 ? chars.slice(0, 35).join('') + '…' : safe;
}

export function renderTable(rows) {
  if (!rows.length) {
    console.log(pc.dim('(empty)'));
    return;
  }
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    json(rows);
    return;
  }
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const columns = [...PREFERRED_KEYS.filter((key) => available.has(key)),
    ...[...available].filter((key) => !PREFERRED_KEYS.includes(key))].slice(0, 8);
  if (!columns.length) { json(rows); return; }
  const table = new Table({ head: columns.map((key) => pc.cyan(cell(key))), style: { head: [] } });
  for (const row of rows) table.push(columns.map((key) => cell(row[key], true)));
  console.log(table.toString());
  console.error(pc.dim(`${rows.length} row(s); use --json for complete data`));
}

export function listResponse(data, asJson) {
  if (asJson) { json(data); return; }
  const rows = extractList(data);
  if (rows === null) json(data);
  else renderTable(rows);
}

export function detailResponse(data, asJson) {
  if (asJson || !data || typeof data !== 'object' || Array.isArray(data)) { json(data); return; }
  const entries = Object.entries(data);
  if (!entries.length) { console.log(pc.dim('(empty)')); return; }
  // Let the terminal wrap long values instead of truncating SSH commands or IDs.
  console.log(entries.map(([key, value]) => `${pc.cyan(cell(key))}: ${cell(value)}`).join('\n'));
}
