import { genericProviderErrorClassifier } from './generic-classifier.js';
import { GIVE_UP } from './internal.js';
import type { ClassifiableError, ProviderErrorClassifier, RetryDecision } from './types.js';

/** 内置 catalog 由 install-builtins 写入，避免 registry↔classifier 循环初始化 */
const REGISTRY = new Map<string, ProviderErrorClassifier>();

export function registerProviderErrorClassifier(classifier: ProviderErrorClassifier): void {
    REGISTRY.set(classifier.provider, classifier);
}

/** 认不出时走 generic；仍无匹配则 permanent give_up */
export function classifyProviderError(provider: string, input: ClassifiableError): RetryDecision {
    const chain = [REGISTRY.get(provider), genericProviderErrorClassifier];
    for (const clf of chain) {
        if (!clf) {
            continue;
        }
        const hit = clf.classify(input);
        if (hit) {
            return hit;
        }
    }
    return { ...GIVE_UP, reason: 'unknown' };
}
