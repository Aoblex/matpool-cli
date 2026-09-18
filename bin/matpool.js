#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { commands } from '../src/commands.js';
import { handleError } from '../src/client.js';

const program = new Command()
  .name('matpool')
  .description('Unofficial CLI for MatPool GPU cloud')
  .version(pkg.version)
  .showHelpAfterError();

program.command('login')
  .description('log in; prompt for omitted credentials in a terminal')
  .option('-n, --name <name>', 'username or phone number')
  .option('-p, --password <password>', 'password (prefer prompt or MATPOOL_PASSWORD)')
  .action(commands.login);

program.command('logout')
  .description('remove local credentials and attempt to invalidate the remote session')
  .action(commands.logout);

for (const [name, description] of [
  ['whoami', 'show current user info'],
  ['balance', 'show account balance'],
  ['hardwares', 'list hardware catalog'],
]) {
  program.command(name).description(description)
    .option('--json', 'complete response data as JSON').action(commands[name]);
}

program.command('machines')
  .description('list available machines')
  .option('-c, --category <category>', 'machine category filter')
  .option('--param <k=v>', 'extra query parameter (repeatable)', (value, previous) => [...previous, value], [])
  .option('--json', 'complete response data as JSON')
  .action(commands.machines);

program.command('images')
  .description('list images')
  .option('-s, --search <keyword>', 'search keyword')
  .option('--json', 'complete response data as JSON')
  .action(commands.images);

program.command('nodes')
  .description('list your instances')
  .option('-c, --category <category>', 'category filter')
  .option('--json', 'complete response data as JSON')
  .action(commands.nodes);

program.command('node')
  .description('show instance detail')
  .argument('<id>', 'positive integer node ID')
  .option('--json', 'complete response data as JSON')
  .action(commands.node);

program.command('rent')
  .description('rent a machine (incurs charges; asks for confirmation)')
  .requiredOption('-m, --machine <id>', 'machine ID (see: matpool machines)')
  .requiredOption('-i, --image <id>', 'image ID (see: matpool images)')
  .option('-q, --qty <n>', 'hardware quantity (positive integer)', '1')
  .option('--cmd <shell>', 'startup command')
  .option('--env <json>', 'environment variables as a JSON-encoded string')
  .option('--channel <channel>', 'channel')
  .option('--dry-run', 'print JSON payload without renting or confirming')
  .option('-y, --yes', 'confirm the billable operation without prompting')
  .action(commands.rent);

program.command('stop')
  .description('request a temporary snapshot, then release (snapshot completion is not verified)')
  .argument('<id>', 'positive integer node ID')
  .option('-y, --yes', 'acknowledge snapshot risk and confirm release without prompting')
  .action(commands.stop);

program.command('release')
  .description('release an instance (unsaved data may be permanently lost)')
  .argument('<id>', 'positive integer node ID')
  .option('-y, --yes', 'confirm deletion without prompting')
  .action(commands.release);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  handleError(err);
}
