/**
 * 写配置前记上一版：有变更则先 recordPrevious，失败则不调用 write。
 */

import { defaultItemCount, payloadsEqual } from './stable-json.js';
import type { SaveWithRevisionInput } from './types.js';

export interface SaveWithRevisionResult<T> {
    result: T;
    /** 本次是否写入了上一版快照；无旧值或内容未变则为 null */
    revisionId: number | null;
    skipped: boolean;
}

/**
 * 若 previous 存在且与 next 实质不同，先写入快照再执行 write。
 * 无 previous（首次种子）或内容相同：不记快照，直接 write。
 */
export async function saveWithRevision<T>(
    input: SaveWithRevisionInput<T>,
): Promise<SaveWithRevisionResult<T>> {
    const previous = input.previousPayload;
    if (previous == null) {
        const result = await input.write();
        return { result, revisionId: null, skipped: true };
    }

    if (payloadsEqual(previous, input.nextPayload)) {
        const result = await input.write();
        return { result, revisionId: null, skipped: true };
    }

    const revisionId = await input.store.recordPrevious({
        namespace: input.namespace,
        payload: previous,
        source: input.source ?? 'put',
        itemCount: input.itemCount ?? defaultItemCount(previous),
    });
    const result = await input.write();
    return { result, revisionId, skipped: false };
}
