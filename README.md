# matpool-cli

矩池云 (matpool.com) 的命令行工具：登录、浏览 GPU 市场、租用和释放实例。

矩池云官方没有提供主机租用的公开 API/CLI，本项目接口均通过逆向 Web 控制台（`/fe-next` 前端 bundle）获得，**未来可能随官网更新而失效**。

## 安装

```bash
git clone https://github.com/Aoblex/matpool-cli.git
cd matpool-cli
npm link   # 或者: npm i -g .
```

要求 Node.js >= 18，无其他依赖。

## 使用

```bash
matpool login --name 13800000000 --password ****   # 用户名或手机号
matpool whoami
matpool balance

matpool machines            # 可租机器列表
matpool hardwares           # 硬件目录
matpool images --search pytorch

matpool rent --machine <machine-id> --image <image-id> --dry-run   # 先看 payload
matpool rent --machine <machine-id> --image <image-id>
matpool nodes
matpool node <node-id>
matpool stop <node-id>      # 保存 24h 临时快照并释放（停止计费）
matpool release <node-id>   # 直接释放
```

凭证保存在 `~/.config/matpool-cli/config.json`（权限 600）。

## 逆向接口参考

Base URL: `https://matpool.com/api`，业务状态在响应体的 `code` 字段（0 为成功）。

鉴权（两个 header 都需要）：

```
Authorization: Bearer <token>     # POST /login 返回
x-matpool-user-id: <user id>     # GET /user 返回的 id
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/login` | 登录，body: `{password, name}` 或 `{password, mobile}` |
| GET | `/user` | 当前用户信息 |
| POST | `/user/logout` | 退出 |
| GET | `/user/account` | 余额/账户 |
| GET | `/user/bills` | 账单 |
| GET | `/machines` | 可租机器列表 |
| GET | `/hardwares` | 硬件目录 |
| GET | `/hardware_range` | 硬件筛选范围 |
| GET | `/images` | 镜像列表 |
| POST | `/node` | 租用（web 表单参数 + `machine_category`、`hardware_qty`） |
| GET | `/nodes` | 我的实例列表 |
| GET | `/node?id=` | 实例详情 |
| PATCH | `/node` | 修改实例 |
| DELETE | `/node` | 释放实例，body: `{id}` |
| POST | `/node/quick_save` | 创建临时快照（24h） |
| POST | `/node/start_by_quick_save` | 从临时快照恢复 |
| POST | `/node/clone` | 克隆实例 |
| GET | `/node/bill` | 实例账单 |
| POST | `/node/storage_sync` | 网盘数据同步 |
| POST | `/flag` | 实例标记 |

## 免责声明

仅供个人学习使用。请遵守矩池云服务条款，不要高频请求。
