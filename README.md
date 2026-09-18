# matpool-cli

An unofficial CLI for [MatPool](https://matpool.com) GPU cloud: log in, browse machines, rent instances, and manage releases.

The API was reverse-engineered from the web console (`/fe-next` frontend bundles). It is not a supported public API and **may change without notice**. Use the web console to verify billing and instance state after an uncertain result.

## Requirements and installation

Requires **Node.js 24 or newer** and npm.

```bash
git clone https://github.com/Aoblex/matpool-cli.git
cd matpool-cli
npm ci
npm link
matpool --help
```

Alternatively, run `node bin/matpool.js` from the checkout instead of linking it.

## Login

```bash
matpool login                        # interactive username and hidden password prompts
matpool login --name 13800000000      # prompt for password only
matpool whoami
matpool balance
matpool logout
```

In automation, supply `--name` and `MATPOOL_PASSWORD` through your runner's secret management. `--password` is supported, but can expose the password in shell history or process arguments. Passwords are never saved to disk.

Tokens are stored unencrypted in `~/.config/matpool-cli/config.json`, with file permissions `0600` on POSIX systems. Treat that file as a secret. Writes are atomic. Failed login attempts leave existing credentials unchanged. Logout removes local credentials first, then attempts to invalidate the remote session; a warning means remote invalidation was not confirmed.

## Browse

```bash
matpool machines
matpool machines --category <category> --param key=value
matpool hardwares
matpool images --search pytorch
matpool nodes
matpool node <node-id>
```

List commands show a compact table. Instance details use key/value output without truncating values. `--param` is repeatable; repeated keys use the last value. `--category` takes precedence over a category supplied through `--param`.

### JSON and scripting

Every read command accepts `--json`:

```bash
matpool nodes --json > nodes.json
matpool machines --json | jq .
```

JSON output preserves the **entire response `data` field**, including any pagination metadata, not the outer `{code, msg, data}` envelope. The CLI fetches one response; it does not automatically traverse pages. Human-readable progress and status messages go to stderr. There is no spinner when stderr is redirected.

Successful commands exit with `0`; validation, authentication, network, and API errors exit nonzero. Declining a confirmation also exits nonzero. Logout succeeds once local credentials are removed, even if remote invalidation fails.

## Rent

Preview the exact payload first. A dry run fetches machine information but does not create an instance:

```bash
matpool rent --machine <machine-id> --image <image-id> --dry-run
matpool rent --machine <machine-id> --image <image-id>
```

Renting incurs charges and asks for confirmation. In automation, explicitly pass `--yes`:

```bash
matpool rent --machine <machine-id> --image <image-id> --qty 1 --yes
```

Additional options: `--cmd <shell>`, `--env <json>`, and `--channel <channel>`. Machine/image IDs and hardware quantity must be positive safe integers. `--qty` maps to the API's `hardware_qty`; it should not be interpreted as a promise to create that many independent instances. `--env` must be valid JSON and is forwarded as a JSON-encoded string in `envs`, preserving the reverse-engineered form's behavior; the accepted JSON structure is determined by the upstream API.

Dry-run stdout is a single JSON document. A successful rental prints the returned `data` as JSON. Payloads and responses may contain secrets, especially environment variables and instance credentials; do not publish them in logs.

## Release and temporary snapshots

```bash
matpool release <node-id>             # asks for confirmation
matpool release <node-id> --yes       # explicitly confirm deletion
matpool stop <node-id>                # request temp snapshot, then release
```

**Release can permanently delete unsaved instance data.** Back up important files before using either command. Non-interactive mutation commands require `--yes`.

`stop` calls `/node/quick_save` and, only if that request succeeds, releases the node. The web console describes this as a free temporary snapshot with nominal 24-hour retention. **This CLI cannot verify that the snapshot has finished or is restorable.** A successful API response may only acknowledge the request. Confirmation (or `--yes`) acknowledges this risk. For important workloads, create and verify a backup in the web console before releasing instead.

If the snapshot request fails, no release is attempted. If release fails afterward, the error reports the partial result; the instance may still be running and accruing charges. Resume from snapshots in the web console; this CLI does not implement restoration.

Requests have a 30-second timeout and are **never automatically retried**. After a timeout or connection failure on a mutation, inspect `matpool nodes`, `matpool node <id>`, or the web console before retrying: the server may already have applied the operation.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MATPOOL_CONFIG` | `~/.config/matpool-cli/config.json` | Credential/config file path |
| `MATPOOL_PASSWORD` | none | Non-interactive login password |
| `MATPOOL_API_BASE` | `https://matpool.com/api` | API base URL; only override for a trusted server |
| `MATPOOL_TIMEOUT_MS` | `30000` | Request timeout in milliseconds (integer, 1–2147483647) |
| `NO_COLOR` | unset | Disable ANSI colors |

An API base override receives credentials. Do not point it at untrusted servers or send real credentials over plain HTTP. Redirects are rejected. A saved `channel` property is used for rental unless overridden by `--channel`. Invalid configuration files produce an error instead of being silently overwritten.

## Development

```bash
npm ci
npm run check
npm test
npm run test:coverage
npm pack --dry-run
```

Native ESM, ESLint, Node's built-in test runner, no build step. Tests use mocked fetch responses and a local HTTP server; they never access MatPool or rent/release real instances.

- `bin/matpool.js`: command definitions and central error handling
- `src/client.js`: authentication headers, timeout, response and network errors
- `src/config.js`: credential reading and atomic private writes
- `src/commands.js`: validation and command workflows
- `src/ui.js`: prompts, confirmations, progress, and rendering
- `test/`: unit and CLI integration tests

## Reverse-engineered API reference

Base URL: `https://matpool.com/api`. Business status is in the numeric `code` field (`0` means success).

Login sends `{password, name}` or `{password, mobile}` without saved credentials. The resulting token is used to fetch `/user`, then subsequent authenticated requests include:

```text
Authorization: Bearer <token>
x-matpool-user-id: <user id>
```

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/login` | Log in; token returned at the response root |
| GET | `/user` | Current user info |
| POST | `/user/logout` | Invalidate session |
| GET | `/user/account` | Account balance |
| GET | `/machines` | Available machines |
| GET | `/hardwares` | Hardware catalog |
| GET | `/images` | Images |
| GET | `/nodes` | User instances |
| GET | `/node?id=` | Instance detail |
| POST | `/node` | Rent using selected machine fields and runtime options |
| DELETE | `/node` | Release; body `{id}` |
| POST | `/node/quick_save` | Request a temporary snapshot; body `{id}` |

Other observed endpoints, not implemented here: `/user/bills`, `/hardware_range`, `PATCH /node`, `/node/start_by_quick_save`, `/node/clone`, `/node/bill`, `/node/storage_sync`, and `/flag`.

## Disclaimer

For personal learning and use. Respect MatPool's terms of service and avoid high-frequency requests. This project is not affiliated with MatPool and cannot guarantee upstream API behavior, snapshot durability, or billing outcomes.
