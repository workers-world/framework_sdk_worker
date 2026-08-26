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
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await mapper(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
