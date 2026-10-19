import type { SecretLike } from '../secrets/resolve.js';
import type {
    AgentArchiveResult,
    AgentCreateInput,
    AgentCreateResult,
    AgentListByPrResult,
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
    /** GET agents filtered by pull request URL */
    listByPr: boolean;
    /** 软归档 agent 会话（不关 PR） */
    archive: boolean;
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
    listByPrUrl?(
        prUrl: string,
        ctx: AgentProviderContext,
        opts?: { includeArchived?: boolean; limit?: number },
    ): Promise<AgentListByPrResult>;
    /** 软归档；runId 可缺。429/5xx 标 retryable，不抛。 */
    archive?(ref: AgentRunRef, ctx: AgentProviderContext): Promise<AgentArchiveResult>;
    /** provider 私有 SSE 帧 → neutral AgentStreamEvent */
    mapStreamEvent?(raw: unknown): AgentStreamEvent | null;
}
