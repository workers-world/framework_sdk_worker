import {
    archiveCursorAgent,
    type CursorAgentRunRef,
    type CursorStreamEvent,
    createCursorAgent,
    fetchCursorAgentRun,
    listCursorAgents,
    listCursorModels,
    streamCursorAgentRun,
} from '../../cursor/cloud-agent.js';
import type { SecretLike } from '../../secrets/resolve.js';
import { normalizeAgentModelInput } from '../model-ref.js';
import type { AgentProvider, AgentProviderContext } from '../provider.js';
import { mapCursorStreamEvent } from '../stream.js';
import type {
    AgentArchiveResult,
    AgentCreateInput,
    AgentCreateResult,
    AgentListByPrResult,
    AgentModelsListResult,
    AgentRunRef,
    AgentRunResult,
    AgentStreamEvent,
    AgentStreamOptions,
} from '../types.js';

function requireCursorApiKey(ctx: AgentProviderContext): SecretLike | null {
    return ctx.secrets.CURSOR_API_KEY ?? null;
}

function toCursorRef(ref: AgentRunRef): CursorAgentRunRef {
    if (!ref.runId) {
        throw new Error('cursor run requires runId');
    }
    return { agentId: ref.agentId, runId: ref.runId };
}

export const cursorAgentProvider: AgentProvider = {
    id: 'cursor',
    capabilities: {
        listModels: true,
        remoteRun: true,
        streaming: true,
        autoPr: true,
        listByPr: true,
        archive: true,
    },

    async listModels(ctx: AgentProviderContext): Promise<AgentModelsListResult> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            return { ok: false, provider: 'cursor', error: 'CURSOR_API_KEY not configured' };
        }
        return listCursorModels(apiKey);
    },

    async createRun(
        input: AgentCreateInput,
        ctx: AgentProviderContext,
    ): Promise<AgentCreateResult> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            return { ok: false, error: 'CURSOR_API_KEY not configured' };
        }
        const model = normalizeAgentModelInput(input.model, 'cursor');
        const result = await createCursorAgent({
            apiKey,
            repoUrl: input.repoUrl,
            promptText: input.promptText,
            modelId: model.modelId,
            autoCreatePR: input.autoCreatePR,
            name: input.name,
        });
        if (!result.ok || !result.ref) {
            return { ok: false, error: result.error, status: result.status };
        }
        return {
            ok: true,
            ref: {
                provider: 'cursor',
                agentId: result.ref.agentId,
                runId: result.ref.runId,
            },
            status: result.status,
        };
    },

    async *streamRun(
        ref: AgentRunRef,
        ctx: AgentProviderContext,
        opts?: AgentStreamOptions,
    ): AsyncIterable<AgentStreamEvent> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            yield {
                eventType: 'error',
                payload: { code: 'config', message: 'CURSOR_API_KEY not configured' },
            };
            return;
        }
        const cursorRef = toCursorRef(ref);
        for await (const ev of streamCursorAgentRun(apiKey, cursorRef, {
            lastEventId: opts?.lastEventId,
        })) {
            yield mapCursorStreamEvent(ev);
        }
    },

    async fetchRun(ref: AgentRunRef, ctx: AgentProviderContext): Promise<AgentRunResult> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            return { status: 'ERROR', error: 'CURSOR_API_KEY not configured' };
        }
        const cursorRef = toCursorRef(ref);
        const result = await fetchCursorAgentRun(apiKey, cursorRef);
        return {
            status: result.status,
            resultText: result.resultText,
            prUrl: result.prUrl,
            error: result.error,
            terminal: result.terminal,
        };
    },

    async listByPrUrl(
        prUrl: string,
        ctx: AgentProviderContext,
        opts?: { includeArchived?: boolean; limit?: number },
    ): Promise<AgentListByPrResult> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            return { ok: false, error: 'CURSOR_API_KEY not configured' };
        }
        const listed = await listCursorAgents(apiKey, {
            prUrl,
            includeArchived: opts?.includeArchived,
            limit: opts?.limit,
        });
        if (!listed.ok || !listed.items) {
            return {
                ok: false,
                error: listed.error,
                status: listed.status,
                retryable: listed.retryable,
            };
        }
        return {
            ok: true,
            items: listed.items.map((item) => ({
                provider: 'cursor' as const,
                agentId: item.id,
                status: item.status,
                url: item.url,
                latestRunId: item.latestRunId,
            })),
        };
    },

    async archive(ref: AgentRunRef, ctx: AgentProviderContext): Promise<AgentArchiveResult> {
        const apiKey = requireCursorApiKey(ctx);
        if (!apiKey) {
            return { ok: false, result: 'error', error: 'CURSOR_API_KEY not configured' };
        }
        const archived = await archiveCursorAgent(apiKey, ref.agentId);
        return {
            ok: archived.ok,
            result: archived.result,
            error: archived.error,
            status: archived.status,
            retryable: archived.retryable,
        };
    },

    mapStreamEvent(raw: unknown): AgentStreamEvent | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }
        const ev = raw as CursorStreamEvent & { id?: string };
        if (!('type' in ev)) {
            return null;
        }
        return mapCursorStreamEvent(ev);
    },
};
