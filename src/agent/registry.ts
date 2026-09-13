import type { AgentProvider, AgentProviderContext } from './provider.js';
import { cursorAgentProvider } from './providers/cursor.js';
import {
    copilotAgentProvider,
    selfHostedAgentProvider,
    smokeAgentProvider,
} from './providers/stub.js';
import type {
    AgentCreateInput,
    AgentCreateResult,
    AgentModelsListResult,
    AgentProviderId,
    AgentRunRef,
    AgentRunResult,
    AgentStreamEvent,
    AgentStreamOptions,
} from './types.js';

const registry = new Map<AgentProviderId, AgentProvider>();

export function registerAgentProvider(provider: AgentProvider): void {
    registry.set(provider.id, provider);
}

export function getAgentProvider(id: AgentProviderId): AgentProvider | undefined {
    return registry.get(id);
}

export function listRegisteredProviders(): AgentProviderId[] {
    return [...registry.keys()];
}

export function ensureDefaultAgentProviders(): void {
    if (registry.size > 0) {
        return;
    }
    registerAgentProvider(cursorAgentProvider);
    registerAgentProvider(selfHostedAgentProvider);
    registerAgentProvider(smokeAgentProvider);
    registerAgentProvider(copilotAgentProvider);
}

function requireProvider(id: AgentProviderId): AgentProvider {
    ensureDefaultAgentProviders();
    const provider = registry.get(id);
    if (!provider) {
        throw new Error(`agent provider not registered: ${id}`);
    }
    return provider;
}

export async function listAgentModels(
    providerId: AgentProviderId,
    ctx: AgentProviderContext,
): Promise<AgentModelsListResult> {
    const provider = requireProvider(providerId);
    if (!provider.capabilities.listModels) {
        return {
            ok: false,
            provider: providerId,
            error: `${providerId} does not support listModels`,
        };
    }
    return provider.listModels(ctx);
}

export async function createAgentRun(
    input: AgentCreateInput,
    ctx: AgentProviderContext,
): Promise<AgentCreateResult> {
    const providerId = input.provider ?? 'cursor';
    const provider = requireProvider(providerId);
    if (!provider.capabilities.remoteRun) {
        return {
            ok: false,
            error: `${providerId} does not support remote agent runs`,
        };
    }
    return provider.createRun(input, ctx);
}

export async function fetchAgentRun(
    ref: AgentRunRef,
    ctx: AgentProviderContext,
): Promise<AgentRunResult> {
    const provider = requireProvider(ref.provider);
    if (!provider.fetchRun) {
        return { status: 'ERROR', error: `${ref.provider} does not support fetchRun` };
    }
    return provider.fetchRun(ref, ctx);
}

export async function* streamAgentRun(
    ref: AgentRunRef,
    ctx: AgentProviderContext,
    opts?: AgentStreamOptions,
): AsyncGenerator<AgentStreamEvent> {
    const provider = requireProvider(ref.provider);
    if (!provider.streamRun) {
        yield {
            eventType: 'error',
            payload: { code: 'unsupported', message: `${ref.provider} does not support streamRun` },
        };
        return;
    }
    yield* provider.streamRun(ref, ctx, opts);
}

ensureDefaultAgentProviders();
