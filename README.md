# matpool-cli

Command line tool for matpool.com (MatPool GPU cloud): log in, browse the GPU market, rent and release instances.

MatPool does not offer an official public API or CLI for host rental. All endpoints in this project were reverse-engineered from the web console (`/fe-next` frontend bundles) and **may break when the site updates**.

## Install

```bash
git clone https://github.com/Aoblex/matpool-cli.git
cd matpool-cli
npm link   # or: npm i -g .
```

Requires Node.js >= 18. Zero dependencies.

## Usage

```bash
matpool login --name 13800000000 --password ****   # username or phone number
matpool whoami
matpool balance

matpool machines            # available machines
matpool hardwares           # hardware catalog
matpool images --search pytorch

matpool rent --machine <machine-id> --image <image-id> --dry-run   # preview payload first
matpool rent --machine <machine-id> --image <image-id>
matpool nodes
matpool node <node-id>
matpool stop <node-id>      # save a free 24h temp snapshot, then release (stops billing)
matpool release <node-id>   # release immediately
```

Credentials are stored in `~/.config/matpool-cli/config.json` (mode 600).

## Reverse-engineered API reference

Base URL: `https://matpool.com/api`. Business status is in the `code` field of the response body (0 = success).

Authentication (both headers are required):

```
Authorization: Bearer <token>     # returned by POST /login
x-matpool-user-id: <user id>     # the `id` field from GET /user
```

| Method | Path | Description |
| --- | --- | --- |
| POST | `/login` | Log in, body: `{password, name}` or `{password, mobile}` |
| GET | `/user` | Current user info |
| POST | `/user/logout` | Log out |
| GET | `/user/account` | Balance / account |
| GET | `/user/bills` | Bills |
| GET | `/machines` | Available machine list |
| GET | `/hardwares` | Hardware catalog |
| GET | `/hardware_range` | Hardware filter ranges |
| GET | `/images` | Image list |
| POST | `/node` | Rent a machine (web form params + `machine_category`, `hardware_qty`) |
| GET | `/nodes` | Your instance list |
| GET | `/node?id=` | Instance detail |
| PATCH | `/node` | Update an instance |
| DELETE | `/node` | Release an instance, body: `{id}` |
| POST | `/node/quick_save` | Create a free temp snapshot (24h) |
| POST | `/node/start_by_quick_save` | Resume from a temp snapshot |
| POST | `/node/clone` | Clone an instance |
| GET | `/node/bill` | Instance billing |
| POST | `/node/storage_sync` | Sync data to cloud disk |
| POST | `/flag` | Mark an instance |

## Disclaimer

For personal learning only. Please respect MatPool's terms of service and avoid high-frequency requests.
