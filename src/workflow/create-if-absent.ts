/**
 * 固定 id 幂等创建（平台 `Workflow.createBatch({ instances })`）。
 * 已存在 id 不进 `created`、记入 `errors`，不抛错；本 helper 返回 null。
 *
 * 注意 null 双义：返回 null 可能是「id 已存在」也可能是「errors-only 失败」；
 * 两者的错误都会 console.warn 输出完整 errors 明细（code+message），排查时以
 * warn 日志为准（already_exists 视为正常幂等，其余 code 需人工跟进）。
 *
 * @see https://developers.cloudflare.com/workflows/build/workers-api/
 * @see https://developers.cloudflare.com/changelog/post/2026-10-08-create-batch-object-form/
 */

/** 对象形式 createBatch 的单条失败（平台返回；类型声明可能滞后于 wrangler 4.148） */
export type WorkflowCreateBatchError = {
    index?: number;
    id?: string;
    code?: number | string;
    message?: string;
};

/** 对象形式 createBatch 的返回值 */
export type WorkflowCreateBatchResult = {
    created: WorkflowInstance[];
    errors: WorkflowCreateBatchError[];
};

/**
 * 接受对象形式 `createBatch` 的最小 Workflow 面。
 * 现有 `@cloudflare/workers-types` 可能仍只声明数组 overload，故用独立接口。
 */
export type WorkflowWithObjectCreateBatch = {
    createBatch(options: {
        instances: Array<{ id: string; params?: unknown }>;
    }): Promise<WorkflowCreateBatchResult>;
};

export type CreateWorkflowIfAbsentOptions = {
    id: string;
    params?: unknown;
};

/**
 * 用对象形式 `createBatch({ instances })` 创建单实例；id 已存在时返回 null。
 * 任一 errors 都打 warn 并输出完整明细（code+message），避免 errors-only
 * 失败静默吞掉、被误读成「已存在」。
 *
 * 入参允许平台 `Workflow`：本地 `@cloudflare/workers-types` 可能仍只声明数组 overload，
 * 运行时对象形式已可用（wrangler ≥ 4.148）。
 */
export async function createWorkflowIfAbsent(
    workflow: WorkflowWithObjectCreateBatch | Workflow,
    options: CreateWorkflowIfAbsentOptions,
): Promise<WorkflowInstance | null> {
    const batchApi = workflow as WorkflowWithObjectCreateBatch;
    const result = await batchApi.createBatch({ instances: [options] });
    if (result.errors.length > 0) {
        console.warn(
            JSON.stringify({
                msg:
                    result.created.length > 0
                        ? 'workflow.createBatch partial errors'
                        : 'workflow.createBatch failed (errors-only, null 返回可能是失败而非已存在)',
                id: options.id,
                created: result.created.map((c) => c.id),
                errors: result.errors.map((e) => ({
                    index: e.index,
                    id: e.id,
                    code: e.code,
                    message: e.message,
                })),
            }),
        );
    }
    return result.created[0] ?? null;
}
