import { type AgentModelRef, type AgentProviderId, isAgentProviderId } from './types.js';

const DEFAULT_PROVIDER: AgentProviderId = 'cursor';

/** 裸 model id 或 composite → AgentModelRef（裸 id 默认 cursor） */
export function parseAgentModelRef(raw: string | null | undefined): AgentModelRef {
    const trimmed = raw?.trim();
    if (!trimmed) {
        return { provider: DEFAULT_PROVIDER, modelId: 'auto' };
    }
    const colon = trimmed.indexOf(':');
    if (colon > 0) {
        const providerPart = trimmed.slice(0, colon).trim().toLowerCase();
        const modelId = trimmed.slice(colon + 1).trim();
        if (isAgentProviderId(providerPart) && modelId) {
            return { provider: providerPart, modelId };
        }
    }
    return { provider: DEFAULT_PROVIDER, modelId: trimmed };
}

/** AgentModelRef → composite 持久化字符串 */
export function formatAgentModelRef(ref: AgentModelRef): string {
    return `${ref.provider}:${ref.modelId}`;
}

/** createRun input.model 归一化 */
export function normalizeAgentModelInput(
    model: AgentModelRef | string | undefined,
    provider: AgentProviderId = DEFAULT_PROVIDER,
): AgentModelRef {
    if (model == null || (typeof model === 'string' && !model.trim())) {
        return { provider, modelId: 'auto' };
    }
    if (typeof model === 'string') {
        const parsed = parseAgentModelRef(model);
        if (!model.includes(':')) {
            return { provider, modelId: parsed.modelId };
        }
        return parsed;
    }
    return model;
}
