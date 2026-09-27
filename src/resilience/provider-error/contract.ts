/** 契约与纯 helper；可被域内 classifier 安全依赖（无 registry/builtin）。 */
export { GIVE_UP, headerRetryAfterSec, messageOf } from './internal.js';
export { classifiableFromUnknown, isWholesaleRateLimitMessage } from './normalize.js';
export type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryAction,
    RetryDecision,
    RetryKind,
} from './types.js';
