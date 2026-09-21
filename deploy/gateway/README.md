# cpx-gateway + cpx-party 部署

一套面向可信内网的 Docker 部署：**Clash Party 完整 Web UI + 机场插件网关 + 局域网共享代理**，一条 `./deploy.sh` 全自动构建启动。

```text
                    ┌────────────────────────────────────────────────┐
LAN 浏览器 ──:3999──►│ party 容器（Clash Party headless Web 模式）      │
                    │  ├─ 完整 React 界面（订阅/覆写/主题）            │
                    │  └─ 自带 mihomo 内核（sidecar 子进程）            │
                    │      ├─ :7890 混合代理口 HTTP+SOCKS5（发布到宿主机）│
                    │      └─ :9090 控制器（仅 compose 内网，不发布）   │
                    └───────────────┬────────────────────────────────┘
                                    │ 反代 panel/REST/WS
LAN 客户端 ───:8080──►┌──────────────▼────────────────┐
                    │ gateway 容器（cpx-gateway）      │
                    │  ├─ 机场插件 v2 API（订阅发放）   │
                    │  └─ :8080 面板 + mihomo API 反代 │
                    └─────────────────────────────────┘
LAN 设备 ────:7890───► party 的 mihomo 内核（HTTP + SOCKS5 共享代理）
```

它提供：

- **Clash Party Web UI**（`:3999`）：与桌面端完全一致的界面，token 鉴权
- **机场插件网关**（`:8080`）：`/.well-known/cpx-gateway` 发现、`/oauth/authorize` 登录页、`/enroll` `/challenge` `/config` `/revoke` 四个网关接口、SQLite 账号/设备管理
- **控制面板**（`:8080/`）：zashboard 面板 + mihomo REST/WebSocket，经网关反代 party 内核，单端口访问
- **局域网共享代理**（`:7890`，HTTP+SOCKS5 混合口）：全部设备可用，订阅在 Web UI 里统一管理

---

## 前置条件

1. 一台内网机器（或 VPS），已安装 Docker 和 Docker Compose v2，项目源码完整在本机。
2. 该机器有客户端可达的固定 IP（如 `192.168.1.100`）。
3. 防火墙放行 TCP 端口：`8080`（网关/面板）、`3999`（Web UI）、`7890`（代理）、`17890+17891+8888+8889`（国家线路口，按需）。
4. **磁盘 ≥ 8GB 可用空间**（party 镜像约 2.9GB，构建缓存峰值较大；不足时先 `docker builder prune -af`）。

> 注意：本改造版已放宽客户端校验（允许 http 与内网 host），并移除了传输加密、SSRF 防护与设备签名。仅适合可信内网自用，不要分发到不可信网络。

---

## 一键部署

```bash
cd deploy/gateway
./deploy.sh
```

六个阶段全自动：`preflight → configure(.env) → build(双镜像) → publish(可选) → run(compose up) → verify(健康检查)`。

首次运行会：

1. 复制 `.env.example` 为 `.env`，询问网关地址（`IP:port`，如 `192.168.1.100:8080`）写入 `PUBLIC_ORIGIN`
2. **自动生成随机 `CP_WEB_TOKEN`**（Web UI 访问令牌，写入 `.env`，可随时改）
3. 构建两个镜像：`cpx-gateway`（Node 网关）+ `cpx-party`（Electron headless + 前端 + mihomo 内核 + geo 资源，走 npmmirror 源）
4. 启动容器并做四项健康检查（网关发现 / Web UI / 代理端口 / 面板反代），成功后打印带 token 的访问链接

首次构建约 10–30 分钟（网络决定）；之后各层走缓存，重建仅数分钟。

### deploy.sh 常用选项

```bash
./deploy.sh                            # 默认：构建并部署 gateway + party
./deploy.sh --services gateway         # 只动网关（跳过 party 漫长构建）
./deploy.sh --services party           # 只动 party
./deploy.sh --no-cache                 # 无缓存彻底重建
./deploy.sh --tag v4.1-prod            # 自定义镜像 tag
./deploy.sh --env-only                 # 只生成 .env，不构建不启动
./deploy.sh --registry reg.local:5000 --push  # 构建并推私有仓库
GATEWAY_ADDR=192.168.1.100:8080 ./deploy.sh   # CI 无人值守（免交互）
NPM_REGISTRY=https://registry.npmjs.org ./deploy.sh  # 覆盖默认 npm 镜像源
```

### 部署完成后

| 访问项                   | 地址                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| Clash Party Web UI       | `http://<IP>:3999/?token=<CP_WEB_TOKEN>`（token 首开后自动存 sessionStorage） |
| 控制面板（zashboard）    | `http://<IP>:8080/`（自动配置后端，无需密钥）                                 |
| 网关发现文件             | `curl http://<IP>:8080/.well-known/cpx-gateway`                               |
| LAN 代理（设备手动配置） | `http://<IP>:7890`（HTTP+SOCKS5 混合口）                                      |
| 国家专线（可选）         | `:17890` AU 通用 / `:17891` AU 全局 / `:8888` JP 通用 / `:8889` JP 全局（先在 Web UI 加订阅，再用 `mihomo-lines` skill 写覆写） |

忘记 token 时：`grep CP_WEB_TOKEN .env` 或 `docker compose logs party | grep 'Web UI'`。

---

## 首次启动与订阅管理

party 容器首次启动时自动写入种子 `mihomo.yaml`（`allow-lan: true` + 控制器 `0.0.0.0:9090`，仅 compose 内网可达），之后该文件归用户所有，可在 Web UI 修改。

**订阅管理全部在 Web UI 完成**（"订阅"页添加/更新/切换），无需编辑任何配置文件——这是与旧版 mihomo 容器最大的区别。

### 国家双口线路（AU / JP，可选）

每国一对端口：通用口走分流（国内直连、国外落本国池），全局口无差别全走本国节点。由 `mihomo-lines` skill 管理，**本目录不放脚本**：

```bash
cd <repo>/.codebuddy/skills/mihomo-lines/scripts
node lines.mjs add AU 17890 '澳洲|Australia|Sydney|悉尼|🇦🇺'   # 加澳洲线
node lines.mjs add JP 8888  '日本|Japan|Tokyo|东京|大阪|🇯🇵'   # 加日本线
node lines.mjs list                                          # 查看已部署线路+当前节点
node lines.mjs verify                                        # 全线路出口验证
node lines.mjs remove AU                                     # 撤销
```

覆写按节点名正则**实时匹配**，机场节点名漂移会自动跟随；两个入口组共用 自动/故障/手动 三个子组。前提是 Web UI 已添加订阅且其中有对应地区节点。端口映射（门）在 `docker-compose.yml`(17890) 与 `docker-compose.override.yml`(17891/8888/8889)。

局域网设备使用代理（在设备侧配置，非服务器侧）：

```text
Windows：设置 → 网络 → 代理 → 手动代理 192.168.x.x:7890
手机 Wi-Fi：当前网络 → 修改 → 代理"手动" → 同上
浏览器插件：SwitchyOmega 等 → 指向 192.168.x.x:7890
```

验证：`curl -x http://<主机IP>:7890 https://www.gstatic.com/generate_204`

---

## 容器部署的功能边界

Web UI 中少数宿主机桌面专属功能在容器内**不可用**，点击时给出明确提示（而非底层报错）：

| 功能                              | 容器内行为                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 系统代理开关                      | 提示"容器部署不支持系统代理"，引导设备手动配置 `:7890`（系统代理只能修改 Clash Party 所在宿主机的系统设置，容器内无桌面环境） |
| TUN 模式开关                      | 提示"容器不可用（未授予 NET_ADMIN / TUN 设备）"（透明代理需宿主机路由能力）                                                   |
| 托盘/悬浮窗/全局快捷键/应用内更新 | Web 模式下隐藏或禁用（官方 web 模式行为）                                                                                     |

其余功能（订阅、节点选择、连接/日志、覆写、主题、WebDAV 备份等）全部可用。

---

## 账号管理（机场插件网关）

每个账号对应一个隐藏订阅 URL，由网关在服务端请求，客户端不会拿到。

```bash
docker compose exec gateway cpx-admin add-user alice 'https://origin.example.com/sub?token=xxxx' --limit 3   # 提示输入密码
docker compose exec gateway cpx-admin list-users
docker compose exec gateway cpx-admin set-sub alice 'https://origin.example.com/sub?token=yyyy'
docker compose exec gateway cpx-admin set-limit alice 5
docker compose exec gateway cpx-admin passwd alice
docker compose exec gateway cpx-admin list-devices alice
docker compose exec gateway cpx-admin revoke-device <deviceId>
docker compose exec gateway cpx-admin del-user alice
```

密码只保存 scrypt hash；`list-users` 默认只显示订阅 host，`--show-sub` 打印完整 URL（排障用）。

## 生成 `.cpx`

在仓库根目录运行（公开插件描述文件，不含任何用户信息，可统一分发）：

```bash
node scripts/plugin/gen-cpx.mjs http://<ip:8080>/oauth/authorize "Your Airport" http://<ip:8080> your-airport.cpx
```

## 请求链路（机场插件 v2）

首次登录：客户端请求发现文件 → 生成随机 `deviceId` → 系统浏览器打开 `/oauth/authorize` → 用户输入账密 → 网关签发一次性 `code`（绑定 PKCE/redirect_uri/client_id，TTL 60s）→ `/enroll` 提交 code+verifier+deviceId → 写入设备绑定。

订阅更新：`/challenge` 领一次性 nonce → `/config` 回传 nonce → 校验防重放 → 网关用该账号隐藏订阅 URL 拉取 Clash YAML 返回。

删除插件：`/revoke`（同样一次性 nonce）→ 删除设备绑定。

---

## 运维

```bash
./deploy.sh                    # 源码更新后重建部署（数据卷保留）
docker compose logs -f party   # 看日志（party / gateway）
docker compose up -d party     # 改 .env 后生效（compose 会重建容器）
```

### 轮换 Web UI 令牌

`CP_WEB_TOKEN` 由 compose 在**创建容器时**从 `.env` 插值进容器（`docker-compose.yml` 的 `environment`），所以 `restart` 不会换值，必须 `up -d` 重建：

```bash
cd deploy/gateway
sed -i 's|^CP_WEB_TOKEN=.*|CP_WEB_TOKEN=<新令牌>|' .env && chmod 600 .env
docker compose up -d party          # 重建；party_data 卷保留，订阅/覆写不丢
docker compose exec party printenv CP_WEB_TOKEN   # 确认已是新值
```

旧令牌即刻失效。别忘了同步更新本地 `tools/mihomo-lines/scripts/lines.config.json`（或 `LINES_TOKEN`）和浏览器书签。新令牌可用 `head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'` 生成。

数据全部持久化在命名卷，重建容器不丢：

| 卷             | 内容                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| `gateway_data` | 网关 SQLite `/data/gateway.db`                                                                |
| `party_data`   | `/data/.config/mihomo-party-dev`（config.yaml / mihomo.yaml / profiles / 覆写 / 主题 / 日志） |

备份网关数据库：

```bash
docker compose exec -T gateway cat /data/gateway.db > gateway.db.backup
```

网关退役（`/challenge`、`/config` 返回 410，客户端回到登录流程）：

```bash
grep -q '^RETIRED=' .env && sed -i.bak 's/^RETIRED=.*/RETIRED=true/' .env || printf '\nRETIRED=true\n' >> .env
docker compose up -d
```

### 常见问题

| 现象                                               | 原因与处理                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 首次构建磁盘写满                                   | 构建缓存 + 双镜像峰值大，`docker builder prune -af` 后重试，保留 ≥8GB 空间          |
| party 容器起不来，日志有 `xauth command not found` | 镜像残缺（旧版构建），`./deploy.sh --services party` 重建                           |
| electron 不启动、Xvfb 起了但无输出                 | compose 已内置 `init: true`（tini 转发 SIGUSR1）；若自改过 compose 移除了该行会复现 |
| npm 依赖下载极慢/超时                              | 默认已走 npmmirror；也可 `NPM_REGISTRY=... ./deploy.sh` 覆盖                        |
| 面板 `:8080/` 打不开或循环                         | 确认 party 容器健康（`docker compose ps`），面板文件由 party 内核首次启动时下载     |

---

## 配置（`.env`）

完整模板见 [`.env.example`](.env.example)。常用项：

| 变量                               | 默认值               | 说明                                                            |
| ---------------------------------- | -------------------- | --------------------------------------------------------------- |
| `PUBLIC_ORIGIN`                    | 无（必填）           | 网关 origin `http://IP:port`，写入发现文件                      |
| `CP_WEB_TOKEN`                     | 首次自动生成         | Web UI 访问令牌，改后 `docker compose up -d party` 生效         |
| `PARTY_WEB_PORT`                   | `3999`               | Web UI 宿主机端口                                               |
| `MIHOMO_MIXED_PORT`                | `7890`               | LAN 混合代理端口（HTTP+SOCKS5）                                 |
| `DEVICE_LIMIT_DEFAULT`             | `3`                  | 新用户默认设备数上限                                            |
| `MIHOMO_API_SECRET`                | 空                   | party 内核若在 UI 设置了控制器密钥，此处镜像一份供反代注入      |
| `RETIRED`                          | `false`              | 网关退役信号                                                    |
| `SUB_TIMEOUT_MS` / `SUB_MAX_BYTES` | `30000` / `10485760` | 拉取隐藏订阅的超时与大小上限                                    |

---

## 开发和自测

- 网关（本目录）：零依赖，Node ≥ 22.5.0，`npm test` / `npm start`
- party 镜像构建细节见 [`deploy/party/Dockerfile`](../party/Dockerfile)；本地跑完整 Web 模式用仓库根 `pnpm run dev:web`

## 安全边界

- 隐藏订阅 URL 是管理员配置项；网关只要求 HTTPS，设超时与响应体上限，不拦截私网地址（便于 origin 放内网）。
- 密码 scrypt hash 保存；code 与 nonce 均一次性短 TTL；登录按 IP 限流。
- mihomo 控制器 `:9090` 不发布宿主机，面板经网关反代访问（compose 网络隔离）。
- Web UI 由 `CP_WEB_TOKEN` 鉴权；22 个桌面危险 channel（杀进程/宿主弹窗/路径暴露类）在 web 模式统一拒绝；`getFileStr`/`setFileStr` 限定 dataDir 内。
- 日志不记录密码、完整订阅 URL、code、nonce 或完整 Clash YAML。
