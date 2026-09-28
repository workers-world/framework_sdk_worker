import { describe, expect, it } from 'vitest';
import {
    assembleAgentDiagnosticsIntake,
    buildAgentDiagnosticsDedupKey,
    groupTailItemDiagnostics,
    isLifecycleCompleteEvent,
    mergeAgentDiagnosticEvents,
    normalizeAgentDiagnosticEvent,
    readAgentDiagnosticsEventsFromPayload,
    resolveAgentDiagnosticsTraceId,
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

    it('unknown fallback', () => {
        const r = resolveAgentDiagnosticsTraceId({
            message: { type: 'rpc' },
            scriptName: 'market-qa-agent',
            eventTimestamp: 42,
        });
        expect(r.traceId).toBe('unknown:market-qa-agent:42');
        expect(r.source).toBe('unknown');
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
});
