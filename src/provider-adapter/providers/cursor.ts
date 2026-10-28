import { fetchCursorAgentUsage } from '../../cursor/cloud-agent.js';
import type { SecretLike } from '../../secrets/resolve.js';
import type { ProviderAdapter, UsageQuery, UsageSnapshot } from '../types.js';

/**
 * 仅 usage（证明可插拔 / 缺能力位）。
 * sch1 本单不改调用点；可后续改接线。
 */
export const cursorUsageAdapter: ProviderAdapter = {
    id: 'cursor',
    capabilities: {
        bindModel: false,
        usage: true,
        billing: false,
        quota: false,
    },

    async resolveUsage(q: UsageQuery): Promise<UsageSnapshot> {
        const agentId = q.agentId?.trim();
        if (!agentId) {
            throw new Error('cursor usage requires agentId');
        }
        const apiKey = q.apiKey as SecretLike | undefined;
        const result = await fetchCursorAgentUsage(apiKey as SecretLike, agentId, {
            runId: q.runId,
        });
        if (!result.ok || !result.usage) {
            return {
                tokens_input: 0,
                tokens_output: 0,
                tokens_reasoning: 0,
                tokens_cache_read: 0,
                tokens_cache_write: 0,
                message_cost_usd: 0,
                correlationId: q.runId ?? agentId,
            };
        }
        const u = result.usage;
        return {
            tokens_input: u.inputTokens,
            tokens_output: u.outputTokens,
            tokens_reasoning: 0,
            tokens_cache_read: u.cacheReadTokens,
            tokens_cache_write: u.cacheWriteTokens,
            message_cost_usd: 0,
            correlationId: q.runId ?? agentId,
        };
    },

    async resolveBilling() {
        throw new Error('cursor adapter does not support billing');
    },
};
