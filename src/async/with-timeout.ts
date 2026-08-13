/**
 * Promise 超时包装：超时抛 Error，由调用方 catch 降级。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
