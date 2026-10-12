/**
 * 固定 id 幂等创建（平台 `Workflow.createBatch({ instances })`）。
 * 已存在 id 不进 `created`、记入 `errors`，不抛错；本 helper 返回 null。
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
 * 若同时有 created 与 errors（部分成功），打 warn 便于观测。
 */
export async function createWorkflowIfAbsent(
    workflow: WorkflowWithObjectCreateBatch,
    options: CreateWorkflowIfAbsentOptions,
): Promise<WorkflowInstance | null> {
    const result = await workflow.createBatch({ instances: [options] });
    if (result.errors.length > 0 && result.created.length > 0) {
        console.warn(
            JSON.stringify({
                msg: 'workflow.createBatch partial errors',
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
