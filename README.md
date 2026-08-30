# framework_sdk_worker

Cloudflare Worker 公共基座 SDK（npm 包 `@workers-world/framework_sdk_worker`，GitHub Packages 私有发布）。

- 生产接入：各 Worker package.json 使用 npm alias——`"framework_sdk_worker": "npm:@workers-world/framework_sdk_worker@<version>"`；升级统一走根目录 `./bump-sdk-consumers.sh <version>`。
- 本地联调：`file:../framework_sdk_worker` 形式（CI 的 `worker-verify` 会把 GitHub Packages 物化到同路径，两种形态代码一致）。
- SDK 改源码后需重新 `npm run build`（`file:` 场景无 `prepare` 钩子，Worker 侧 `npm install` 前确保 `dist/` 已存在；`scripts/ensure-dist.mjs` 提供补偿构建）。

## 运行时要求

- **compatibility_date ≥ 2024-09-23**（建议跟随 org 规范最新值）：SDK 使用 `AbortSignal.timeout`（notify / audit-log / id-generator / ai / mcp 各 client 均依赖）。
- Secrets 通过 `SecretLike`（string 或 Secrets Store binding）统一解析，禁用 `process.env`。
- Hono 为 peer dependency（^4），消费方自带。

## 可靠性假设（重要）

- **KV 去重（`framework_sdk_worker/kv`）是 best-effort 防重**：Workers KV 最终一致（跨 POP 最长 ~60s），`claimSendSlot` 的 get→put 非原子。消除绝大多数重复发送，但不构成强互斥；强一致占位请用 D1 唯一约束或 Durable Object。
- **熔断（`framework_sdk_worker/resilience/circuit-breaker`）**：KV 版读改写非原子、读有秒级陈旧窗口，同为 best-effort；内存版阈值按 isolate 独立计数。
- 各 client（notify / audit-log / id-generator / ai）对上游异常一律返回 `{ok:false, error}`，不抛裸异常；分页接口有页数上限。

## 日志规范

规范入口是 `framework_sdk_worker/ops-error`（`createOpsLogger` / `reportOpsError`，带敏感字段脱敏 + 告警邮件）。`framework_sdk_worker/logger` 为轻量场景准备，内部同样过 `sanitizeForLog`。error/message 字段不脱敏（排障主载荷），但告警邮件侧截断封顶。

## 子模块

- `framework_sdk_worker/notify` — notify-worker 客户端
- `framework_sdk_worker/audit-log` — 通用维护日志客户端（`writeMaintenanceLog`，对接 audit-log-worker）
- `framework_sdk_worker/id-generator` — 发号客户端（`generateId`，对接 counter-worker；本地序号器仅供 counter-worker 服务端/单测）
- `framework_sdk_worker/auth` — Bearer 鉴权（常数时间比较）
- `framework_sdk_worker/hono` — Hono 应用骨架
- `framework_sdk_worker/meta` — `GET /v1/meta` 运行时自述（SDK 版本构建时注入 + BUILD_* + 可选 Version Metadata）
- `framework_sdk_worker/http` — JSON 解析、错误响应、页面 meta 抓取（DoH 预检 + 每跳私网校验）
- `framework_sdk_worker/r2` — R2 写入封装
- `framework_sdk_worker/r2/gold-price` — 金价 R2 读取
- `framework_sdk_worker/kv` — KV 去重
- `framework_sdk_worker/time` — 上海时区工具（`shanghaiYmd` / `shanghaiYmdDash` / `shanghaiIsoString` / `shanghaiYmPath` / `shanghaiMinuteBucket` / `shanghaiClock` / `shanghaiStamp14`）
- `framework_sdk_worker/ai` — AI Gateway 配置与 LLM Gateway 客户端
- `framework_sdk_worker/ai/direct` — env.AI 直连统一封装（Agent/tool-loop 场景；超时 + `{ok:false}` 契约 + AI Gateway 注入）
- `framework_sdk_worker/logger` — 轻量日志（带脱敏）

### `/v1/meta` 接入

```typescript
import { registerMetaRoute } from 'framework_sdk_worker/meta';

registerMetaRoute(app, { workerName: 'invest-rss-worker' });
// Bearer: RULES_ADMIN_TOKEN（可改 authEnvKey）
```

`wrangler.toml` 建议：

```toml
[vars]
BUILD_COMMIT_SHA = ""   # CF Builds / CI 注入
BUILD_BRANCH = "master"
BUILD_TIME = ""

[version_metadata]
binding = "CF_VERSION_METADATA"
```

响应不含 env/secret 值；部署 inventory / env 指纹仍由 deploy-tracker + CF API 负责。
