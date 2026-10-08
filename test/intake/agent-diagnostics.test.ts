import { describe, expect, it } from 'vitest';
import {
    assembleAgentDiagnosticsIntake,
    buildAgentDiagnosticsDedupKey,
    groupTailItemDiagnostics,
    isLifecycleCompleteEvent,
    isPlumbingOnlyAgentDiagnostics,
    mergeAgentDiagnosticEvents,
    normalizeAgentDiagnosticEvent,
    readAgentDiagnosticsEventsFromPayload,
    resolveAgentDiagnosticsTraceId,
    sanitizeAgentDiagnosticMessage,
    shouldSkipPlumbingOnlyDefaultDiagnostics,
} from '../../src/intake/agent-diagnostics.js';
import { INTAKE_KIND_AGENT_DIAGNOSTICS } from '../../src/intake/kinds.js';
import {
    INTAKE_BLOCK_WORKER_IO_STREAM,
    isIntakePayloadEnvelope,
} from '../../src/intake/payload-envelope.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';

describe('resolveAgentDiagnosticsTraceId', () => {
    it('prefers conversationId', () => {
        const r = resolveAgentDiagnosticsTraceId({
            message: { type: 'rpc', conversationId: 'lineage-abc', payload: { method: 'x' } },
            scriptName: 'market-qa-agent',
            eventTimestamp: 100,
        });
        expect(r).toEqual({
            traceId: 'lineage-abc',
            conversationId: 'lineage-abc',
            source: 'conversationId',
        });
    });

    it('falls back to W3C traceId', () => {
        const tid = 'a'.repeat(32);
        const r = resolveAgentDiagnosticsTraceId({
            message: { type: 'rpc', payload: { method: 'x' } },
            tailTraceId: tid,
            scriptName: 'market-qa-agent',
            eventTimestamp: 100,
        });
        expect(r.traceId).toBe(tid);
        expect(r.source).toBe('traceId');
    });

    it('falls back to DO instance name before unknown', () => {
        const r = resolveAgentDiagnosticsTraceId({
            message: {
                type: 'chat:turn:start',
                agent: 'MarketQaAgent',
                name: 'eac1ce5d-721f-4e9e-bba6-6a2350244be6',
            },
            scriptName: 'market-qa-agent',
            eventTimestamp: 42,
        });
        expect(r).toEqual({
            traceId: 'eac1ce5d-721f-4e9e-bba6-6a2350244be6',
            source: 'instanceName',
        });
    });

    it('unknown fallback when no conversationId/trace/name', () => {
        const r = resolveAgentDiagnosticsTraceId({
            message: { type: 'rpc' },
            scriptName: 'market-qa-agent',
            eventTimestamp: 42,
        });
        expect(r.traceId).toBe('unknown:market-qa-agent:42');
        expect(r.source).toBe('unknown');
    });
});

describe('sanitizeAgentDiagnosticMessage', () => {
    it('keeps payload body but redacts tokens', () => {
        const out = sanitizeAgentDiagnosticMessage({
            type: 'chat:message',
            name: 'sess-1',
            payload: {
                role: 'assistant',
                text: '今日黄金偏强',
                authToken: 'secret-value',
            },
        });
        expect(out.payload).toEqual({
            role: 'assistant',
            text: '今日黄金偏强',
            authToken: '[redacted]',
        });
    });
});

describe('plumbing-only default skip', () => {
    it('detects plumbing-only mcp handshake', () => {
        const events = [
            normalizeAgentDiagnosticEvent(
                'agents:mcp',
                { type: 'mcp:client:connect', name: 'default' },
                1,
            ),
            normalizeAgentDiagnosticEvent(
                'agents:mcp',
                { type: 'mcp:client:discover', name: 'default' },
                2,
            ),
        ];
        expect(isPlumbingOnlyAgentDiagnostics(events)).toBe(true);
        expect(
            shouldSkipPlumbingOnlyDefaultDiagnostics({
                traceId: 'default',
                incomingEvents: events,
            }),
        ).toBe(true);
    });

    it('does not skip chat turn on UUID instance', () => {
        const events = [
            normalizeAgentDiagnosticEvent(
                'agents:chat',
                {
                    type: 'chat:turn:start',
                    name: 'eac1ce5d-721f-4e9e-bba6-6a2350244be6',
                },
                1,
            ),
        ];
        expect(
            shouldSkipPlumbingOnlyDefaultDiagnostics({
                traceId: 'eac1ce5d-721f-4e9e-bba6-6a2350244be6',
                incomingEvents: events,
            }),
        ).toBe(false);
    });
});

describe('lifecycle complete', () => {
    it('detects disconnect/destroy on agents:lifecycle', () => {
        expect(isLifecycleCompleteEvent('agents:lifecycle', 'disconnect')).toBe(true);
        expect(isLifecycleCompleteEvent('agents:lifecycle', 'destroy')).toBe(true);
        expect(isLifecycleCompleteEvent('agents:lifecycle', 'connect')).toBe(false);
        expect(isLifecycleCompleteEvent('agents:rpc', 'disconnect')).toBe(false);
    });
});

describe('merge + assemble', () => {
    it('merges two batches into one story intake', async () => {
        const e1 = normalizeAgentDiagnosticEvent(
            'agents:rpc',
            { type: 'rpc', conversationId: 'story-1', payload: { method: 'ask' } },
            1000,
        );
        const e2 = normalizeAgentDiagnosticEvent(
            'agents:lifecycle',
            { type: 'disconnect', conversationId: 'story-1' },
            2000,
        );
        const merged = mergeAgentDiagnosticEvents([e1], [e2]);
        expect(merged).toHaveLength(2);

        const first = await assembleAgentDiagnosticsIntake(
            {},
            {
                worker: 'market-qa-agent',
                traceId: 'story-1',
                conversationId: 'story-1',
                incomingEvents: [e1],
                primaryRepo: 'workers-world/market-qa-agent',
            },
        );
        expect(first.kind).toBe(INTAKE_KIND_AGENT_DIAGNOSTICS);
        expect(first.dedupKey).toBe(buildAgentDiagnosticsDedupKey('market-qa-agent', 'story-1'));
        expect(validateIntakeEvent(first)).toBeNull();
        expect(isIntakePayloadEnvelope(first.payload)).toBe(true);
        expect(first.summary).toContain('进行中');

        const second = await assembleAgentDiagnosticsIntake(
            {},
            {
                worker: 'market-qa-agent',
                traceId: 'story-1',
                conversationId: 'story-1',
                incomingEvents: [e2],
                existingPayload: first.payload,
                markComplete: true,
            },
        );
        expect(second.dedupKey).toBe(first.dedupKey);
        expect(second.summary).toContain('已结束可评审');
        const events = readAgentDiagnosticsEventsFromPayload(second.payload);
        expect(events).toHaveLength(2);
        const stream = (
            second.payload as { blocks: Array<{ type: string; data: { eventCount?: number } }> }
        ).blocks;
        const io = stream.find((b) => b.type === INTAKE_BLOCK_WORKER_IO_STREAM);
        expect(io?.data.eventCount).toBe(2);
    });

    it('groupTailItemDiagnostics groups by conversationId', () => {
        const groups = groupTailItemDiagnostics({
            scriptName: 'market-qa-agent',
            eventTimestamp: 99,
            diagnosticsChannelEvents: [
                {
                    channel: 'agents:rpc',
                    timestamp: 1,
                    message: { type: 'rpc', conversationId: 'c1', payload: { method: 'a' } },
                },
                {
                    channel: 'agents:rpc',
                    timestamp: 2,
                    message: { type: 'rpc', conversationId: 'c1', payload: { method: 'b' } },
                },
                {
                    channel: 'agents:lifecycle',
                    timestamp: 3,
                    message: { type: 'disconnect', conversationId: 'c1' },
                },
            ],
        });
        expect(groups.size).toBe(1);
        const g = groups.get('c1');
        expect(g?.events).toHaveLength(3);
        expect(g?.complete).toBe(true);
    });

    it('groupTailItemDiagnostics merges across invocations by DO name', () => {
        const session = 'eac1ce5d-721f-4e9e-bba6-6a2350244be6';
        const first = groupTailItemDiagnostics({
            scriptName: 'market-qa-agent',
            eventTimestamp: 1000,
            diagnosticsChannelEvents: [
                {
                    channel: 'agents:chat',
                    timestamp: 1001,
                    message: { type: 'chat:turn:start', agent: 'MarketQaAgent', name: session },
                },
            ],
        });
        const second = groupTailItemDiagnostics({
            scriptName: 'market-qa-agent',
            eventTimestamp: 2000,
            diagnosticsChannelEvents: [
                {
                    channel: 'agents:lifecycle',
                    timestamp: 2001,
                    message: { type: 'disconnect', agent: 'MarketQaAgent', name: session },
                },
            ],
        });
        expect(first.size).toBe(1);
        expect(second.size).toBe(1);
        expect(first.has(session)).toBe(true);
        expect(second.has(session)).toBe(true);
        expect(second.get(session)?.complete).toBe(true);
        const secondKey = [...second.keys()][0];
        expect(secondKey).toBe(session);
        expect(buildAgentDiagnosticsDedupKey('market-qa-agent', session)).toBe(
            buildAgentDiagnosticsDedupKey('market-qa-agent', secondKey ?? ''),
        );
    });
});
