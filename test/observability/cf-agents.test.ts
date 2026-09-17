import { describe, expect, it } from 'vitest';
import {
    buildCfAgentsDashboardUrl,
    buildCfAgentsLineagePointer,
    buildCfAgentsTelemetryMetadata,
    buildWorkersTraceUrl,
    MARKET_QA_AGENT_FUNCTION_ID,
    MARKET_QA_AGENT_PRODUCTION_ID,
} from '../../src/observability/cf-agents.js';

describe('buildCfAgentsTelemetryMetadata', () => {
    it('always sets production agentId', () => {
        expect(buildCfAgentsTelemetryMetadata({})).toEqual({
            agentId: MARKET_QA_AGENT_PRODUCTION_ID,
        });
    });

    it('mirrors lineageId as conversationId and optional fields', () => {
        expect(
            buildCfAgentsTelemetryMetadata({
                lineageId: 'line-1',
                draftId: 9,
                source: 'desk',
            }),
        ).toEqual({
            agentId: MARKET_QA_AGENT_PRODUCTION_ID,
            lineageId: 'line-1',
            conversationId: 'line-1',
            draftId: 9,
            source: 'desk',
        });
    });

    it('allows draftId 0', () => {
        expect(buildCfAgentsTelemetryMetadata({ draftId: 0 }).draftId).toBe(0);
    });
});

describe('buildCfAgentsLineagePointer', () => {
    it('uses function name plus production id', () => {
        expect(buildCfAgentsLineagePointer('abc')).toEqual({
            agentName: MARKET_QA_AGENT_FUNCTION_ID,
            agentId: MARKET_QA_AGENT_PRODUCTION_ID,
            conversationId: 'abc',
        });
    });
});

describe('dashboard / trace URLs', () => {
    it('builds agents dashboard with or without account and query', () => {
        expect(buildCfAgentsDashboardUrl({})).toBe(
            'https://dash.cloudflare.com/?to=/:account/agents',
        );
        expect(buildCfAgentsDashboardUrl({ accountId: 'acc' })).toBe(
            'https://dash.cloudflare.com/acc/agents',
        );
        expect(
            buildCfAgentsDashboardUrl({
                accountId: 'acc',
                agentId: 'ag',
                conversationId: 'cv',
            }),
        ).toBe('https://dash.cloudflare.com/acc/agents?agentId=ag&conversationId=cv');
        expect(buildCfAgentsDashboardUrl({ agentId: 'ag' })).toContain('agentId=ag');
    });

    it('builds workers observability trace URL', () => {
        expect(buildWorkersTraceUrl({})).toBe(
            'https://dash.cloudflare.com/?to=/:account/workers/observability/traces',
        );
        expect(buildWorkersTraceUrl({ accountId: 'acc', requestId: 'ray/1' })).toBe(
            'https://dash.cloudflare.com/acc/workers/observability/traces?requestId=ray%2F1',
        );
        expect(buildWorkersTraceUrl({ accountId: 'acc' })).toBe(
            'https://dash.cloudflare.com/?to=/:account/workers/observability/traces',
        );
    });
});
