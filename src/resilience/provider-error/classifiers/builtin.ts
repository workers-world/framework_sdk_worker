import { llmGatewayProviderErrorClassifier } from '../../../ai/provider-error-classifier.js';
import { cursorProviderErrorClassifier } from '../../../cursor/provider-error-classifier.js';
import { githubProviderErrorClassifier } from '../../../github/provider-error-classifier.js';
import { r2ProviderErrorClassifier } from '../../../r2/provider-error-classifier.js';
import { genericProviderErrorClassifier } from '../generic-classifier.js';
import type { ProviderErrorClassifier } from '../types.js';

/** 内置 catalog；测试或扩展可 registerProviderErrorClassifier 覆盖 */
export const BUILTIN_PROVIDER_ERROR_CLASSIFIERS: ProviderErrorClassifier[] = [
    cursorProviderErrorClassifier,
    githubProviderErrorClassifier,
    llmGatewayProviderErrorClassifier,
    r2ProviderErrorClassifier,
];

export { genericProviderErrorClassifier };
