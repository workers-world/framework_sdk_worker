/**
 * 外部 Provider 错误分类完整 API（package / 业务侧入口）。
 * 契约与纯 helper 亦再导出；域内 classifier 请用上层 `../provider-error.js` 短路径以免循环依赖。
 */

import './install-builtins.js';

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
export { GIVE_UP, headerRetryAfterSec, messageOf } from './internal.js';
export { classifiableFromUnknown, isWholesaleRateLimitMessage } from './normalize.js';
export { classifyProviderError, registerProviderErrorClassifier } from './registry.js';
export type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryAction,
    RetryDecision,
    RetryKind,
} from './types.js';
