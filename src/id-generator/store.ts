/**
 * 按 prefix + 业务日期分配递增序号的存储抽象。
 */
export interface IdSequenceStore {
    /** 获取并递增序号（从 1 开始）。 */
    nextSeq(prefix: string, bizDate: string): Promise<number>;
}

/**
 * 进程内序号存储，重启后丢失；适用于单测或无 DB 场景。
 */
export class InMemoryIdSequenceStore implements IdSequenceStore {
    private readonly counters = new Map<string, number>();

    async nextSeq(prefix: string, bizDate: string): Promise<number> {
        const key = `${prefix}:${bizDate}`;
        const next = (this.counters.get(key) ?? 0) + 1;
        this.counters.set(key, next);
        return next;
    }
}
