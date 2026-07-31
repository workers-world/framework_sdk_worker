import {shanghaiYmd} from '../time/shanghai.js';
import {MAX_SEQ, SequenceOverflowError} from './types.js';
import type {IdSequenceStore} from './store.js';

export class IdGenerator {
    constructor(
        private readonly prefix: string,
        private readonly store: IdSequenceStore,
    ) {
    }

    async genId(bizDate: string = shanghaiYmd()): Promise<string> {
        const seq = await this.store.nextSeq(this.prefix, bizDate);
        if (seq > MAX_SEQ) {
            throw new SequenceOverflowError(this.prefix, bizDate, seq);
        }
        return `${this.prefix}${bizDate}${String(seq).padStart(6, '0')}`;
    }
}

export async function genId(
    prefix: string,
    store: IdSequenceStore,
    bizDate: string = shanghaiYmd(),
): Promise<string> {
    return new IdGenerator(prefix, store).genId(bizDate);
}
