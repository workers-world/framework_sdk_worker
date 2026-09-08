import { describe, expect, it } from 'vitest';
import {
    buildOpsErrorDedupKey,
    buildOpsErrorIntake,
    buildQualityClusterIntake,
    buildQualityLogDigestIntake,
} from '../../src/intake/builders.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';

describe('buildOpsErrorIntake', () => {
    it('sets kind and stable dedupKey', () => {
        const event = buildOpsErrorIntake({
            producer: 'invest-rss-worker',
            worker: 'invest-rss-worker',
            reason: 'queue_give_up',
            error: 'boom id=1234567890123',
        });
        expect(event.schemaVersion).toBe(1);
        expect(event.kind).toBe('ops.error');
        expect(event.dedupKey).toMatch(
            /^ops\.error:invest-rss-worker:queue_give_up:[a-f0-9]+:\d{4}-\d{2}-\d{2}$/,
        );
        expect(validateIntakeEvent(event)).toBeNull();
    });

    it('dedupKey stable for normalized error', () => {
        const a = buildOpsErrorDedupKey('w', 'r', 'err id=1111111111111');
        const b = buildOpsErrorDedupKey('w', 'r', 'err id=2222222222222');
        expect(a).toBe(b);
    });
});

describe('buildQualityClusterIntake', () => {
    it('uses clusterId in dedupKey', () => {
        const event = buildQualityClusterIntake({
            clusterId: 'svc|kind|because|host',
            windowStart: '2026-09-08 00:00:00',
            windowEnd: '2026-09-08 00:30:00',
            caseCount: 2,
            hardCount: 1,
            cases: [{ dedupKey: 'd1' }],
        });
        expect(event.dedupKey).toBe('quality.cluster:svc|kind|because|host');
        expect(validateIntakeEvent(event)).toBeNull();
    });
});

describe('buildQualityLogDigestIntake', () => {
    it('aligns dedupKey with email part', () => {
        const event = buildQualityLogDigestIntake({
            digestDate: '2026-09-08',
            partIndex: 2,
            partTotal: 3,
            captureCount: 5,
            repos: ['workers-world/email-rule-worker'],
            analyzeMode: 'batch',
            attachmentNames: ['part2.zip'],
        });
        expect(event.dedupKey).toBe('quality.log_digest:2026-09-08:part-2');
        expect(validateIntakeEvent(event)).toBeNull();
    });
});

describe('validateIntakeEvent', () => {
    it('rejects missing dedupKey', () => {
        const event = buildOpsErrorIntake({
            producer: 'w',
            worker: 'w',
            reason: 'r',
            error: 'e',
        });
        event.dedupKey = '';
        expect(validateIntakeEvent(event)).toBe('dedupKey required');
    });
});
