import type { SecretLike } from '../secrets/resolve.js';
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

export interface AgentProviderCapabilities {
    listModels: boolean;
    remoteRun: boolean;
    streaming: boolean;
    autoPr: boolean;
}

export interface AgentProviderContext {
    secrets: Record<string, SecretLike | undefined>;
    fetch?: typeof fetch;
}

export interface AgentProvider {
    readonly id: AgentProviderId;
    readonly capabilities: AgentProviderCapabilities;
    listModels(ctx: AgentProviderContext): Promise<AgentModelsListResult>;
    createRun(input: AgentCreateInput, ctx: AgentProviderContext): Promise<AgentCreateResult>;
    streamRun?(
        ref: AgentRunRef,
        ctx: AgentProviderContext,
        opts?: AgentStreamOptions,
    ): AsyncIterable<AgentStreamEvent>;
    fetchRun?(ref: AgentRunRef, ctx: AgentProviderContext): Promise<AgentRunResult>;
    /** provider 私有 SSE 帧 → neutral AgentStreamEvent */
    mapStreamEvent?(raw: unknown): AgentStreamEvent | null;
}
