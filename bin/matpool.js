#!/usr/bin/env node
import { commands } from '../src/commands.js';
import { handleError } from '../src/client.js';
import { die } from '../src/config.js';

const USAGE = `matpool-cli - command line tool for matpool.com (MatPool GPU cloud)

usage: matpool <command> [options]

auth:
  login [--name <username|phone>] [--password <pwd>]   log in (prompts interactively when flags omitted;
                                                     password also via MATPOOL_PASSWORD)
  logout                                               remove stored credentials
  whoami                                               show current user info
  balance                                              show account balance

market:
  machines [--category <c>] [--param k=v ...]          list available machines
  hardwares                                            list hardware catalog
  images [--search <kw>] [--param k=v ...]             list images

instances:
  nodes [--category <c>] [--param k=v ...]             list your nodes
  node <id>                                            show node detail
  rent --machine <id> --image <id> [--qty N]           rent a machine
       [--cmd "<shell>"] [--env "<JSON>"] [--channel C] [--dry-run]
  stop <id>                                            save a temp snapshot and release the node
  release <id>                                         release (delete) a node

options:
  --json    (reserved) raw JSON output is the default
  -h, --help  show this help

credentials are stored in ~/.config/matpool-cli/config.json (mode 600).
`;

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        opts[key] = true;
      } else if (key === 'param') {
        (opts.param = opts.param || []).push(next);
        i++;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

const fn = commands[cmd];
if (!fn) {
  console.log(USAGE);
  die(`unknown command: ${cmd}`);
}

const { opts, positional, help } = parseArgs(rest);
if (help) {
  console.log(USAGE);
  process.exit(0);
}

fn(...positional, opts)
  .catch((err) => handleError(err));
