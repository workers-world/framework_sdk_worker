# 入队幂等 SDK 迁移 sketch（文档 only）

本文件不触发任何 worker 自动迁移；仅供 dly2 / rev1 在窗口期手工对照。

## dly2 box-test（ReuseIfActive）

1. 绑定 KV（或后续 DO storage 自适配 `IdempotencyStore`）。
2. `const store = createKvIdempotencyStore(env.DEDUP_KV, { keyPrefix: 'box:' })`。
3. 入队前：`const r = await ReuseIfActive.tryClaim(store, dedupeKey, { jobRef: jobId })`。
   - `reuse` → 返回已有 job 响应，不再 enqueue。
   - `claim` → 正常入队；成功后 `store.confirmSuccess(dedupeKey, { jobRef })`。
   - 失败路径：`store.release(dedupeKey)`（与现有 failed 可重跑一致）。
4. webhook 路径保留 SHA dedupe；裸 POST 传 `force: true` 对齐「故意不去重」。

## rev1 WW-527（BlockIfSucceeded）

1. 将 DO `JOB_KEY` 成功终端写入改为 `store.confirmSuccess(key, { ttlSeconds })`。
2. 入队 admit：`BlockIfSucceeded.tryClaim(store, jobKey, { jobRef })`。
   - `blocked` → 409 / 业务拒收（success 或 in-flight）。
   - `claim` → 继续 DO 入队；运行期可 `KvIdempotencyStore.persist` 推进 `running`（若仍用 KV 镜像）。
3. job 失败：`store.release(jobKey)`，与 WW-527 fail 清 claim 一致。

## 验收清单

- [ ] 集成测试覆盖 force、success 挡板、fail reclaim
- [ ] 监控 reuse/blocked 计数
- [ ] 回滚：保留旧 dedupe 分支直至灰度结束
