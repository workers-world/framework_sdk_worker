/**
 * 同步 CPU 预算探测：用 performance.now() 包裹纯同步段。
 * 超过阈值只打结构化日志，不抛错；等待 I/O 的代码不要包进 fn。
 */

export const DEFAULT_CPU_BUDGET_MS = 5;

export interface CpuBudgetOptions {
    /** 超过该毫秒数打 warn；默认 5 */
    thresholdMs?: number;
}

/**
 * 测量同步 fn 耗时；超阈值输出 `event=cpu_budget_exceeded`。
 * @returns fn 的返回值
 */
export function withCpuBudget<T>(label: string, fn: () => T, options?: CpuBudgetOptions): T {
    const thresholdMs = options?.thresholdMs ?? DEFAULT_CPU_BUDGET_MS;
    const start = performance.now();
    try {
        return fn();
    } finally {
        const elapsedMs = performance.now() - start;
        if (elapsedMs >= thresholdMs) {
            console.warn(
                JSON.stringify({
                    event: 'cpu_budget_exceeded',
                    msg: '同步段超过 CPU 预算阈值',
                    label,
                    elapsedMs: Math.round(elapsedMs * 100) / 100,
                    thresholdMs,
                }),
            );
        }
    }
}
