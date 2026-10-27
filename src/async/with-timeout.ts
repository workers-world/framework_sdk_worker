/**
 * Promise 超时包装：超时抛 Error，由调用方 catch 降级。
 * 注意：超时只是放弃等待，底层 promise（如未传 signal 的 fetch）会继续执行——
 * 需要真正取消时，请在创建 promise 时绑定 AbortSignal 并通过 options.signal
 * 传入外部取消源。
 */
export async function withTimeout<T>(
    p: Promise<T>,
    ms: number,
    label: string,
    options?: { signal?: AbortSignal },
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
    });

    let onAbort: (() => void) | undefined;
    let external: Promise<never> | undefined;
    const signal = options?.signal;
    if (signal) {
        const reason = signal.reason ?? new Error(`${label} aborted`);
        if (signal.aborted) {
            external = Promise.reject(reason);
        } else {
            external = new Promise<never>((_, reject) => {
                onAbort = () => reject(reason);
                signal.addEventListener('abort', onAbort, { once: true });
            });
        }
    }

    try {
        return await Promise.race(external ? [p, timeout, external] : [p, timeout]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
        if (onAbort && signal) {
            signal.removeEventListener('abort', onAbort);
        }
    }
}
