# PostgreSQL 迁移计划书

> 状态标记：✅ 完成 · 🔄 进行中 · ⏸ 未开始 · ❌ 已回滚
> 最近更新：2026-10-08

## 总目标

流量用量数据从浏览器 IndexedDB 迁到服务端 PostgreSQL：集中留存、修复"关页面断记"缺陷、获得 SQL 查询能力。订阅/覆写/应用配置**明确留 YAML 不迁**（mihomo 只吃文件、低频写、无查询需求）。

## 第一期：流量数据入库（✅ 已完成并部署 53）

### 基础设施

- [x] 53 起专用 PG 容器 `clash-party-pg`（postgres:18，127.0.0.1:5433，库/用户 `clash_party`，数据 /var/lib/clash-party-pg）
- [x] compose 注入 `CP_DATABASE_URL`，镜像重建上线

### 代码（仓库工作树，未 commit）

- [x] `src/main/db/index.ts` — 连接层：懒初始化 Pool，未设 env=全关；建表 + BRIN(ts) 索引
- [x] `src/main/db/trafficIngest.ts` — 采集：delta 逻辑搬主进程挂连接流，5s 批量 INSERT，缓冲封顶 1 万，每日 30 天保留清理
- [x] `src/main/db/dataUsageQuery.ts` — 查询：SQL GROUP BY 聚合（rankings/trend/子维度）
- [x] `src/main/db/trafficIngest.test.ts` — 5 个 delta 单测
- [x] IPC 9 个新通道（查询/导入/清空/开关/后端状态）
- [x] 渲染层：删 IndexedDB 类与 logger hook；usage 卡开关改控服务端；存量自动迁移（legacy-db-migrate.ts）
- [x] 修 flush 占位符偏移 bug（i*8→i*7，生产首验暴露）
- [x] typecheck + 198 老测试 + 5 新测试全绿

### 验证（53 生产实测）

- [x] 真实流量入库（IP/host/节点/字节正确），无浏览器会话持续记录
- [x] 桥 invoke 查询聚合正确；容器日志 0 error
- [x] **浏览器 UI 实测（2026-10-08）**：用量页渲染真实数据（90 会话 / 15.85 MB / 域名排行）；
      维度切换（设备/域名/代理/进程）走 SQL GROUP BY；点行展开明细表；时间范围切换；
      采集开关真实切换服务端 `ingestActive`；存量 IndexedDB 迁移（造旧数据→重载→入库→删库）；
      console 无报错
- [x] 修复「渲染层 IPC 白名单漏登记」缺陷（UI 静默显示 0；见下）

### 期间修复的缺陷

- flush 占位符偏移（`i*8`→`i*7`）→ 生产首验暴露，已修
- **渲染层 IPC 白名单漏登记**：新增 9 个流量通道只加主进程 handler，浏览器 shim 白名单未同步 →
  UI invoke 被客户端直接 reject、页面静默显示 0（桥直连绕过 shim 才没暴露）。修复：
  白名单抽到 `src/shared/ipcChannels.ts` + `ipcChannels.test.ts` 双向锁死注册表

## 收尾（⏸ 待办）

- [x] commit 第一期改动（`e9fa19b`，已 push）
- [x] commit 白名单修复（`13fff19`）+ lint 清理（`6941492`），均已 push
- [x] README 补 PG 说明（技术栈行 + 「流量用量与 PostgreSQL（可选）」小节 + Docker/tarball 接入示例 + 安全边界）
- [ ] changelog：按该文件“只在发布时追加”的约定，等下次发版再写本期条目
- [ ] 本机 `_cpx-deploy` 同步新构建（可选：不带 CP_DATABASE_URL 行为同旧版）

## 第二期：日志查询（✅ 已完成并部署 53，2026-10-08）

- [x] `logs` 表（ts BRIN / level / module / message），启动建表，保留 7 天每日清理
      （2026-10-09 剔除 source 列与"应用"入库路：库里只留内核日志，启动 SQL `DROP COLUMN IF EXISTS` 幂等迁移）
- [x] 单路写入：内核 `mihomoLogs` 流挂 onData
  - logIngest 不 import logger/db-index（避免环），pool 由 manager 注入，错误走 console.warn
- [x] IPC：`queryLogs`（级别/关键字/时间窗 + 分页 total）、`clearLogs`；白名单已同步（护栏测试通过）
- [x] logs 页「实时/历史」双 tab：历史 = 级别+范围筛选、关键字、分页、清空；PG 未配置时提示
- [x] 期间修复：`epoch_ms()` 在该 PG 构建不存在 → `(extract(epoch FROM ts)*1000)::bigint`；
      i18n 插值 `{n}` → `{{n}}`
- [x] 53 实测：表自动建立、内核/应用日志入库、queryLogs 四种过滤全对、UI 历史 tab 渲染（计数/分页/筛选）；
      列表体渲染受内嵌浏览器 0×0 视口限制未目视（数据链路已验，LogItem 组件为实时页同款）
- [x] typecheck + lint 0 warning + 205 测试全绿

## 边界决策（已定，勿重开）

- WebDAV 备份不含 PG（流量数据可重建，不做 pg_dump）
- 不引迁移框架（CREATE TABLE IF NOT EXISTS 足够）
- `enableTrafficLogger` appConfig 键保留（UI 开关状态），实际生效走 setTrafficIngestEnabled

## 运维速查

```bash
# 53 上直连
docker exec -it clash-party-pg psql -U clash_party -d clash_party
# 看最近入库
select ts, source_ip, host, outbound, download from data_usage_logs order by ts desc limit 10;
# 连接串（已注入 deploy/party 的 docker-compose.override.yml，由 release.sh 自动维护）
postgres://clash_party:clash_party_53@127.0.0.1:5433/clash_party
```
