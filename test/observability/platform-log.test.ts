import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    buildObservabilityCaptureBundle,
    extractPlatformLogEventArray,
    observabilityCaptureR2Key,
    parsePlatformLogEvent,
    parsePlatformLogEvents,
    resolveInvocationIdFromLogEvent,
} from '../../src/observability/platform-log.js';

const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../fixtures/platform-log-sample.json',
);

describe('parsePlatformLogEvents', () => {
    it('preserves $workers and $metadata from REST-shaped array', () => {
        const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown[];
        const events = parsePlatformLogEvents(raw);
        expect(events.length).toBeGreaterThan(0);
        const first = events[0];
        expect(first?.$metadata?.requestId).toBe('9YYFVE6K6SMI9OOW');
        expect(first?.$metadata?.type).toBe('cf-worker');
        expect(first?.$workers?.scriptName).toBe('email-rule-worker');
    });

    it('preserves cf-worker-event invocation row fields', () => {
        const invocationRow = {
            level: 'info',
            message: 'user@example.com',
            $workers: {
                scriptName: 'email-rule-worker',
                outcome: 'ok',
                requestId: '9YYFVE6K6SMI9OOW',
                wallTimeMs: 1264,
                cpuTimeMs: 26,
            },
            $metadata: {
                requestId: '9YYFVE6K6SMI9OOW',
                type: 'cf-worker-event',
                service: 'email-rule-worker',
            },
            futurePlatformField: { nested: true },
        };
        const parsed = parsePlatformLogEvent(invocationRow);
        expect(parsed?.$workers?.wallTimeMs).toBe(1264);
        expect(parsed?.$metadata?.type).toBe('cf-worker-event');
        expect(parsed?.futurePlatformField).toEqual({ nested: true });
    });

    it('unwraps { result: { events } } REST envelope', () => {
        const raw = [{ message: 'a', $metadata: { requestId: 'X' } }];
        const wrapped = { result: { events: raw } };
        expect(extractPlatformLogEventArray(wrapped)).toHaveLength(1);
        expect(parsePlatformLogEvents(wrapped)).toHaveLength(1);
    });
});

describe('resolveInvocationIdFromLogEvent', () => {
    it('prefers metadata invocationId then requestId then workers.requestId', () => {
        expect(
            resolveInvocationIdFromLogEvent({
                $metadata: { invocationId: 'inv-1', requestId: 'req-1' },
            }),
        ).toBe('inv-1');
        expect(resolveInvocationIdFromLogEvent({ $metadata: { requestId: 'req-2' } })).toBe(
            'req-2',
        );
        expect(resolveInvocationIdFromLogEvent({ $workers: { requestId: 'req-3' } })).toBe('req-3');
    });
});

describe('buildObservabilityCaptureBundle', () => {
    it('builds versioned envelope for R2', () => {
        const events = parsePlatformLogEvents(JSON.parse(readFileSync(fixturePath, 'utf8')));
        const bundle = buildObservabilityCaptureBundle({
            invocationId: '9YYFVE6K6SMI9OOW',
            events,
            role: 'email',
            dedupKey: 'custom:<test@mx>',
            fetchedAt: '2026-08-21T01:40:00.000Z',
        });
        expect(bundle.schemaVersion).toBe(1);
        expect(bundle.eventCount).toBe(events.length);
        expect(bundle.events[0]?.$metadata?.requestId).toBe('9YYFVE6K6SMI9OOW');
        expect(observabilityCaptureR2Key('9YYFVE6K6SMI9OOW')).toBe(
            'quality-capture/logs/9YYFVE6K6SMI9OOW.json',
        );
    });
});
