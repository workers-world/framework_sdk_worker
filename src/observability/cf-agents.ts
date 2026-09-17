/**
 * Cloudflare Agents Dashboard / Workers Observability 跳转 helper。
 */

export const MARKET_QA_AGENT_FUNCTION_ID = 'market-qa-agent' as const;
export const MARKET_QA_AGENT_PRODUCTION_ID = 'market-qa-agent-production' as const;

export type CfAgentsIdentity = {
    agentName: string;
    agentId: string;
    conversationId?: string;
    lineageId?: string;
};

/** AI SDK experimental_telemetry.metadata（勿把用户问题当 conversationId） */
export function buildCfAgentsTelemetryMetadata(input: {
    lineageId?: string;
    draftId?: number;
    source?: string;
}): Record<string, string | number> {
    const meta: Record<string, string | number> = {
        agentId: MARKET_QA_AGENT_PRODUCTION_ID,
    };
    if (input.lineageId) {
        meta.lineageId = input.lineageId;
        meta.conversationId = input.lineageId;
    }
    if (input.draftId != null) {
        meta.draftId = input.draftId;
    }
    if (input.source) {
        meta.source = input.source;
    }
    return meta;
}

export function buildCfAgentsLineagePointer(lineageId: string): {
    agentName: string;
    agentId: string;
    conversationId: string;
} {
    return {
        agentName: MARKET_QA_AGENT_FUNCTION_ID,
        agentId: MARKET_QA_AGENT_PRODUCTION_ID,
        conversationId: lineageId,
    };
}

/** CF Dashboard Agents tab deep link（account 占位由 Admin 替换或拼接） */
export function buildCfAgentsDashboardUrl(input: {
    accountId?: string;
    agentId?: string;
    conversationId?: string;
}): string {
    const base = input.accountId
        ? `https://dash.cloudflare.com/${input.accountId}/agents`
        : 'https://dash.cloudflare.com/?to=/:account/agents';
    const params = new URLSearchParams();
    if (input.agentId) {
        params.set('agentId', input.agentId);
    }
    if (input.conversationId) {
        params.set('conversationId', input.conversationId);
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
}

export function buildWorkersTraceUrl(input: { accountId?: string; requestId?: string }): string {
    if (input.accountId && input.requestId) {
        return `https://dash.cloudflare.com/${input.accountId}/workers/observability/traces?requestId=${encodeURIComponent(input.requestId)}`;
    }
    return 'https://dash.cloudflare.com/?to=/:account/workers/observability/traces';
}
