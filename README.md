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
matpool machines --category gpu --page 2 --per-page 10
matpool machines --param key=value
matpool hardwares
matpool images --search "pytorch cuda" --machine <agent-id>
matpool nodes
matpool node <node-id>
```

List commands show curated columns rather than truncated nested JSON. User and instance summaries omit credential-bearing fields. Use `--json` for the full response, which may include sensitive data.

All list commands support `--page` (default 1) and `--per-page` (default 20). The API requires both. `machines`, `hardwares`, and `images` accept `--category gpu|cpu|npu` (or `0|1|3`), defaulting to GPU. Image search uses space-separated keywords; `--machine` filters images for an agent ID.

`machines --param` is repeatable; repeated keys use the last value. Explicit paging flags override `page`/`per_page` parameters, and `--category` overrides `machine_category`. Price columns retain the API's `priceMillicent` units; they are not yuan amounts.

### JSON and scripting

Every read command accepts `--json`:

```bash
matpool nodes --json > nodes.json
matpool machines --json | jq .
```

The API does not use a uniform response envelope: `/user` returns a top-level `user`, and `/user/account` returns `account` plus other fields. JSON output preserves all these top-level payload fields, excluding status fields `code` and `msg`. For responses wrapped in `data`, it outputs the entire `data` field, including any pagination metadata. The CLI fetches one response; it does not automatically traverse pages. Human-readable progress and status messages go to stderr. There is no spinner when stderr is redirected.

Successful commands exit with `0`; validation, authentication, network, and API errors exit nonzero. Declining a confirmation also exits nonzero. Logout succeeds once local credentials are removed, even if remote invalidation fails.

## Rent

Preview the exact payload first. A dry run fetches machine information but does not create an instance:

```bash
matpool rent --machine <agent-id> --image <image-id> --dry-run
matpool rent --machine <agent-id> --image <image-id>
```

Renting incurs charges and asks for confirmation. In automation, explicitly pass `--yes`:

```bash
matpool rent --machine <agent-id> --image <image-id> --qty 1 --yes
```

`--machine` is the **`agentId` shown by `matpool machines`**, not a hardware catalog ID or `resourceID`. The CLI fetches that machine directly, so it does not depend on finding it on the first market page. Resource-pool and prepaid package rentals are not implemented.

Additional options: `--cmd <shell>`, `--env 'KEY=value;KEY2=value'`, and `--channel <channel>`. Environment variables use semicolon-separated assignments, **not JSON**; semicolons/newlines inside values are not supported. IDs and quantity must be positive safe integers. `--qty` is the number of allocation units (`hardware_qty`), not necessarily physical GPUs, CPU cores, or independent instances. The CLI checks current availability and per-instance limits, but resources may change before the server handles the request. A dry run validates the local payload, not server-side image compatibility or final billing.

Dry-run stdout is a single JSON payload. A successful rental prints the complete API response (including `code`); a status-only acknowledgment is valid. Read-command `--json` output and mutation payloads/responses may contain secrets, especially service tokens, environment variables and instance credentials; do not publish them in logs.

## Release and temporary snapshots

```bash
matpool release <node-id>             # asks for confirmation
matpool release <node-id> --yes       # explicitly confirm deletion
matpool stop <node-id>                # ask the server to save, then stop asynchronously
```

**Release can permanently delete unsaved instance data.** Back up important files before using either command. Non-interactive mutation commands require `--yes`.

`stop` reads the instance to obtain its `displayID`, then verifies `supportQuickSave` using the matching node-list entry (the detail endpoint can incorrectly return `false`). It then follows the web client: `POST /node/quick_save` with `{request_id: displayID, cancel_node: true}`. **The server coordinates saving and stopping; the CLI never sends a separate DELETE.** The response is an acknowledgment, not proof that the instance has stopped or the snapshot is restorable.

The web console describes nominal 24-hour snapshot retention and warns that a failed save can leave the instance running and billing. Verify completion in the web console before considering the operation finished. Back up important files separately. Resume from snapshots in the web console; this CLI does not implement restoration.

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
- `src/views.js`: allowlisted human summaries for nested API objects
- `test/`: unit and CLI integration tests

## Reverse-engineered API reference

Base URL: `https://matpool.com/api`. Business status is in the numeric `code` field (`0` means success).

Login sends `{password, name}` or `{password, mobile}` without saved credentials. The resulting token is used to fetch `/user`; the current web client reads the ID from `response.user.id`. Subsequent authenticated requests include:

```text
Authorization: Bearer <token>
x-matpool-user-id: <user id>
```

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/login` | Log in; token returned at the response root |
| GET | `/user` | Current user info in `user`, plus top-level service metadata |
| POST | `/user/logout` | Invalidate session |
| GET | `/user/account` | Account data in `account`, plus top-level coupon metadata |
| GET | `/machines` | Available machines; requires `page` and `per_page` |
| GET | `/machine?agent_id=` | One machine for rental payload preparation |
| GET | `/hardwares` | Hardware catalog |
| GET | `/images` | Images |
| GET | `/nodes` | User instances |
| GET | `/node?id=` | Instance detail |
| POST | `/node` | Rent using `agent_id`, `image_id`, `machine_category`, `hardware_qty`, and runtime options |
| DELETE | `/node` | Release; body `{id}` |
| POST | `/node/quick_save` | Save and stop; body `{request_id: displayID, cancel_node: true}` |

Other observed endpoints, not implemented here: `/user/bills`, `/hardware_range`, `PATCH /node`, `/node/start_by_quick_save`, `/node/clone`, `/node/bill`, `/node/storage_sync`, and `/flag`.

## Disclaimer

For personal learning and use. Respect MatPool's terms of service and avoid high-frequency requests. This project is not affiliated with MatPool and cannot guarantee upstream API behavior, snapshot durability, or billing outcomes.
