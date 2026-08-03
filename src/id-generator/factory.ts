import { IdGenerator } from './generator.js';
import type { IdSequenceStore } from './store.js';
import { InMemoryIdSequenceStore } from './store.js';

/**
 * ID 生成器工厂，按 prefix 缓存 IdGenerator 实例。
 */
export class IdFactory {
    private readonly generators = new Map<string, IdGenerator>();

    constructor(private readonly store: IdSequenceStore = new InMemoryIdSequenceStore()) {}

    getIdGenerator(prefix: string): IdGenerator {
        let generator = this.generators.get(prefix);
        if (!generator) {
            generator = new IdGenerator(prefix, this.store);
            this.generators.set(prefix, generator);
        }
        return generator;
    }
}
