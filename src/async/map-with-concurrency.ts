export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    let failed = false;
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    async function worker(): Promise<void> {
        while (!failed) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            try {
                results[index] = await mapper(items[index], index);
            } catch (e: unknown) {
                // 首 reject 后停止派发新任务：已在执行的任务自然收尾，副作用不再扩大
                failed = true;
                throw e;
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
