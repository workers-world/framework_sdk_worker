# framework_sdk_worker

Cloudflare Worker 公共基座 SDK。本地联调时各 Worker 通过 `file:` 引用本包。

## 安装

```bash
cnpm install
cnpm run build
```

> SDK 改源码后需重新 `cnpm run build`。Worker 侧 `cnpm install` 前确保 `dist/` 已存在（无 `prepare` 钩子）。

## 本地接入 Worker

在 Worker 的 `package.json` 中添加：

```json
{
  "dependencies": {
    "framework_sdk_worker": "file:../framework_sdk_worker"
  }
}
```

然后在该 Worker 目录执行：

```bash
cnpm install
```

## 子模块

- `framework_sdk_worker/notify` — notify-worker 客户端
- `framework_sdk_worker/audit-log` — 通用维护日志客户端（`writeMaintenanceLog`，对接 audit-log-worker）
- `framework_sdk_worker/id-generator` — 发号客户端（`generateId`，对接 counter-worker）
- `framework_sdk_worker/auth` — Bearer 鉴权
- `framework_sdk_worker/hono` — Hono 应用骨架
- `framework_sdk_worker/meta` — `GET /v1/meta` 运行时自述（SDK 版本 + BUILD_* + 可选 Version Metadata）
- `framework_sdk_worker/http` — JSON 解析与错误响应
- `framework_sdk_worker/r2` — R2 写入封装

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
- `framework_sdk_worker/r2/gold-price` — 金价 R2 读取
- `framework_sdk_worker/kv` — KV 去重
- `framework_sdk_worker/time` — 上海时区工具（`shanghaiYmd` / `shanghaiYmdDash` / `shanghaiIsoString` / `shanghaiYmPath` / `shanghaiMinuteBucket`）
- `framework_sdk_worker/ai` — AI Gateway 配置
- `framework_sdk_worker/logger` — 结构化日志
