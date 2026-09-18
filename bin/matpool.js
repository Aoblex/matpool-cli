#!/usr/bin/env node
import { Command } from 'commander';
import { commands } from '../src/commands.js';
import { handleError } from '../src/client.js';

const program = new Command();

program
  .name('matpool')
  .description('Command line tool for matpool.com (MatPool GPU cloud)')
  .version('0.1.0');

program
  .command('login')
  .description('log in (prompts interactively when flags are omitted)')
  .option('-n, --name <name>', 'username or phone number')
  .option('-p, --password <password>', 'password (or use MATPOOL_PASSWORD)')
  .action((opts) => commands.login(opts).catch(handleError));

program
  .command('logout')
  .description('remove stored credentials')
  .action(() => commands.logout().catch(handleError));

program
  .command('whoami')
  .description('show current user info')
  .option('--json', 'raw JSON output')
  .action((opts) => commands.whoami(opts).catch(handleError));

program
  .command('balance')
  .description('show account balance')
  .option('--json', 'raw JSON output')
  .action((opts) => commands.balance(opts).catch(handleError));

program
  .command('machines')
  .description('list available machines')
  .option('-c, --category <category>', 'machine category filter')
  .option('--param <k=v>', 'extra query parameter (repeatable)', collect, [])
  .option('--json', 'raw JSON output')
  .action((opts) => commands.machines(opts).catch(handleError));

program
  .command('hardwares')
  .description('list hardware catalog')
  .option('--json', 'raw JSON output')
  .action((opts) => commands.hardwares(opts).catch(handleError));

program
  .command('images')
  .description('list images')
  .option('-s, --search <keyword>', 'search keyword')
  .option('--json', 'raw JSON output')
  .action((opts) => commands.images(opts).catch(handleError));

program
  .command('nodes')
  .description('list your instances')
  .option('-c, --category <category>', 'category filter')
  .option('--json', 'raw JSON output')
  .action((opts) => commands.nodes(opts).catch(handleError));

program
  .command('node')
  .description('show instance detail')
  .argument('<id>')
  .option('--json', 'raw JSON output')
  .action((id, opts) => commands.node(id, opts).catch(handleError));

program
  .command('rent')
  .description('rent a machine')
  .requiredOption('-m, --machine <id>', 'machine id (see: matpool machines)')
  .requiredOption('-i, --image <id>', 'image id (see: matpool images)')
  .option('-q, --qty <n>', 'number of machines', '1')
  .option('--cmd <shell>', 'startup command')
  .option('--env <json>', 'environment variables as JSON')
  .option('--channel <channel>', 'channel')
  .option('--dry-run', 'print the payload without renting')
  .action((opts) => commands.rent(opts).catch(handleError));

program
  .command('stop')
  .description('save a free 24h temp snapshot, then release the node')
  .argument('<id>')
  .action((id) => commands.stop(id).catch(handleError));

program
  .command('release')
  .description('release (delete) a node')
  .argument('<id>')
  .action((id) => commands.release(id).catch(handleError));

function collect(value, previous) {
  return previous.concat([value]);
}

program.parse(process.argv);
