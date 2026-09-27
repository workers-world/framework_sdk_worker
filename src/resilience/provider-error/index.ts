/**
 * 外部 Provider 错误分类：契约 types；各 provider 实现在 cursor/github/ai/r2；
 * 注册表 registry；generic 回退留在本目录。
 */

export { llmGatewayProviderErrorClassifier } from '../../ai/provider-error-classifier.js';
export { cursorProviderErrorClassifier } from '../../cursor/provider-error-classifier.js';
export { githubProviderErrorClassifier } from '../../github/provider-error-classifier.js';
export { r2ProviderErrorClassifier } from '../../r2/provider-error-classifier.js';
export { genericProviderErrorClassifier } from './generic-classifier.js';
export {
    githubRetryDelayMs,
    isGithubRequestRetryable,
    isWholesaleRateLimitError,
} from './github-retry.js';
export { classifiableFromUnknown, isWholesaleRateLimitMessage } from './normalize.js';
export { classifyProviderError, registerProviderErrorClassifier } from './registry.js';
export type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryAction,
    RetryDecision,
    RetryKind,
} from './types.js';
