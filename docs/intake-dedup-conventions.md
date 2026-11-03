# Intake dedupKey 约定（SDK 通用层）

## 分层

| 层 | 职责 |
|----|------|
| **SDK** (`framework_sdk_worker/intake`) | 段归一化、可选日桶拼接、`quality.artifact` / `ops.error` 等 **kind 级默认公式**；不承载 desk 业务 dedup |
| **生产者**（如 decision-desk-worker） | 业务稳定 key（如 `data_bad` 按 underlying 折叠）；通过 `dedupKey` 显式传入 `submitQualityArtifact*` |

## API

- `normalizeIntakeDedupSegment` — trim + 折叠空白
- `joinIntakeDedupKeyParts` — 非空段用 `:` 连接
- `buildIntakeDedupKey(prefix, segments, dayBucket?)` — 稳定 key 或追加上海日历日 `YYYY-MM-DD`

## sch1 行为

同一 `dedup_key` 再次入库时 upsert 合并（hit count 递增）。生产者应选择：

- **稳定 key**：慢性同类问题合并为一条 intake
- **日桶 key**：按日滚动（SDK 内建 builder 如 `ops.error`、`quality.artifact` 默认带日桶）

## `submitQualityArtifact` / `kindOverride`

`kindOverride` 仅改写 Intake **kind**（如 `desk.draft_quality`），**不再**推导 desk 专用 dedup 公式。

- 需要稳定业务 dedup：**必须**传 `dedupKey`（decision-desk-worker 在 companion WW-618 中落地）。
- 未传 `dedupKey` 时：一律使用通用 `buildQualityArtifactDedupKey`（`quality.artifact:…` 形），避免 SDK 隐式拼 `lineageId+day`。

## 发布顺序（Gate A）

1. decision-desk-worker 先上线显式 `dedupKey`（#146 / WW-618）
2. 再 bump 本 SDK 版本并移除 desk builder 导出

已移除的公开 API：`buildDeskDraftQualityDedupKey`、`buildDeskDraftQualityIntake`、`buildDeskObsDumpDedupKey`、`buildDeskObsDumpIntake`（迁至 decision-desk-worker）。

保留：`INTAKE_KIND_DESK_*` kind 常量、`DeskDraftQualityIntakePayload` / `DeskObsDumpIntakePayload` 类型。
