# Verified API contracts

These observations come from read-only authenticated requests and the public web client. They are not an upstream stability guarantee. No real account responses or credentials are checked into this repository; `test/fixtures.js` uses synthetic values with observed shapes.

## Public web client evidence

Inspected bundles (paths are relative to `https://matpool.com/fe-next/js/`):

- `app.e0b6b768.js`: `fetchUserInfo` destructures `{user, code, services, ...rest}` and the store reads `user.id`. `fetchAccount` destructures `account` and `couponAmountYuan`.
- `6674.900a5831.js`: module 34916 builds resource identifiers as `{hardware_id: host.id, agent_id: host.agentId}` for individual hosts, and `{image_id: Number(imageId)}`. Current `/machine` responses have no `id`, so `hardware_id` is omitted. Image search uses `keywords: JSON.stringify(keywordList)` and `page`/`per_page`.
- `3163.935e28c0.js`: `getRentParams` sets `vnc_switcher`, `auto_password`, channel, and optional runtime fields. `EnvsInput` explicitly documents `FOO=bar;BAZ=tic`.
- `8921.27b27798.js`: `rentHost` adds `machine_category` and `hardware_qty`. Quantity is `floor(hostNum / unitStep)` with `unitStep = physicalTotal / unit.total`. Rental success is based on `code === 0`, not the presence of `data`.
- `5993.ae269a96.js`: `NodePause.onSubmit` calls `quickSaveNode({request_id: nodeData.displayID, cancel_node: true})`. There is no subsequent DELETE. Its UI warns that a failed snapshot resumes running/billing. `NodeRelease` uses the numeric instance ID. Node lists use `userNodes`; detail uses `userNode`.

## Read-only response shapes

| Endpoint | Payload fields |
| --- | --- |
| `/user` | `user`, `services`, account/service metadata |
| `/user/account` | `account`, `couponAmountYuan` |
| `/machines` | `machines`, `pagination` |
| `/machine?agent_id=…` | `machine` |
| `/hardwares` | `hardwares`, `pagination` |
| `/images` | `images`, `pagination` |
| `/nodes` | `userNodes`, `pagination` |
| `/node?id=…` | `userNode` |

All four list endpoints reject requests without `page` and `per_page`. Pagination fields are `total`, `numPages`, `page`, and `perPage`.

`machines[]` contains `agentId`, `resourceID`, nested `hardware`, physical resource capacities, and `unit`; it does not contain a top-level `id`. `userNodes[]` contains `node.id`, `displayID`, `agentID`, `status`, and `supportQuickSave`.

## Safety boundaries

Human summaries allowlist fields because user and instance responses can contain passwords, service tokens, image credentials, environment variables, and storage keys. Explicit `--json` remains unredacted for local scripting.

Read commands and rental dry-run were verified against the real API. Rent, release, save-and-stop, and logout mutations were not exercised against real resources. Their request contracts are covered by synthetic tests and public frontend evidence; actual billing, image compatibility, and asynchronous completion still require upstream confirmation.
