# config-revision — 配置变更历史

`import { createConfigRevisionStore, saveWithRevision } from 'framework_sdk_worker/config-revision'`

## 用途

Admin / API **覆盖写业务配置** 时，写前把上一版整份 JSON 记入本 Worker D1，可列表与回退。与 `audit-log`（跨仓事件摘要）分工：本模块持**可恢复正文**。

## 接入步骤

1. 复制 [sql/config_revisions.sql](../sql/config_revisions.sql) 到 Worker `migrations/` 并 apply。
2. `createConfigRevisionStore({ db: env.DB_*, techBusinessIdPrefix: '{worker}_{service}' })`。
3. 写配置处包 `saveWithRevision({ store, namespace, previousPayload, nextPayload, write })`；无 D1 时业务侧可降级仅 warn。
4. 暴露 Admin list / get / restore（参考 email-rule-worker `/v1/rules/revisions*`）。

## namespace 约定

| 示例 | 含义 |
|------|------|
| `email-rules` | 邮件订阅规则整表 |
| `content-filter:{scope}:{stage}` | 某 scope 的 before/after 过滤 |
| `sch1:settings:pr-ready` | 日后 sch1 单项设置 |

## 后续待接仓（清单）

- sch1 `admin-settings` 各 PUT
- invest-rss rules
- notify 旁路主题等 Admin 可改配置

运行时只读缓存刷新不算配置变更。
