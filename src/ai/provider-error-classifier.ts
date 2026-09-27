/**
 * llm-gateway / AI Gateway 错误分类（Neurons 4006、wholesale 2018）。
 */
import {
    type ClassifiableError,
    headerRetryAfterSec,
    isWholesaleRateLimitMessage,
    type ProviderErrorClassifier,
    type RetryDecision,
} from '../resilience/provider-error.js';

function isNeuronQuotaMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes('4006') ||
        m.includes('neuron_quota') ||
        m.includes('daily free allocation') ||
        m.includes('neurons 配额')
    );
}

export const llmGatewayProviderErrorClassifier: ProviderErrorClassifier = {
    provider: 'llm-gateway',
    classify(input: ClassifiableError): RetryDecision | null {
        const message = input.message ?? '';
        if (isNeuronQuotaMessage(message)) {
            return {
                kind: 'quota',
                retryable: true,
                reason: 'neuron_4006',
                action: 'defer_until',
            };
        }
        if (isWholesaleRateLimitMessage(message) || input.status === 429) {
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds: headerRetryAfterSec(input.headers) ?? 60,
                reason: 'wholesale_2018',
                action: 'retry',
            };
        }
        return null;
    },
};
