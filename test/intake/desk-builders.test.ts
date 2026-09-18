import { describe, expect, it } from 'vitest';
import {
    buildDeskDraftQualityDedupKey,
    buildDeskDraftQualityIntake,
    buildDeskObsDumpDedupKey,
    buildDeskObsDumpIntake,
} from '../../src/intake/builders.js';
import {
    INTAKE_KIND_DESK_DRAFT_QUALITY,
    INTAKE_KIND_DESK_OBS_DUMP,
} from '../../src/intake/kinds.js';
import {
    buildIntakePayloadEnvelope,
    buildMarkdownBlock,
} from '../../src/intake/payload-envelope.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';
import { shanghaiYmdDash } from '../../src/time.js';

describe('desk intake builders', () => {
    it('buildDeskDraftQualityIntake uses defaults and optional fields', () => {
        const event = buildDeskDraftQualityIntake({
            lineageId: 'line-abcdef12',
            draftId: 9,
            underlying: '518880',
            reason: 'thin_body',
            primaryRepo: 'workers-world/decision-desk-worker',
            links: [{ rel: 'self', href: 'https://x' }],
        });
        expect(event.kind).toBe(INTAKE_KIND_DESK_DRAFT_QUALITY);
        expect(event.dedupKey).toBe(buildDeskDraftQualityDedupKey('line-abcdef12', 'thin_body'));
        expect(event.dedupKey).toContain(shanghaiYmdDash());
        expect(event.source.producer).toBe('decision-desk-worker');
        expect(event.title).toContain('518880');
        expect(event.summary).toContain('draftId=9');
        expect(event.payload).toMatchObject({
            lineageId: 'line-abcdef12',
            draftId: 9,
            underlying: '518880',
            reason: 'thin_body',
            primaryRepo: 'workers-world/decision-desk-worker',
        });
        expect(validateIntakeEvent(event)).toBeNull();
    });

    it('omits optional payload fields and honors envelope / overrides', () => {
        const envelope = buildIntakePayloadEnvelope({
            index: { lineageId: 'L' },
            blocks: [buildMarkdownBlock('n', 'Note', 'x')],
        });
        const event = buildDeskDraftQualityIntake({
            producer: 'other',
            lineageId: 'L',
            reason: 'x',
            payloadEnvelope: envelope,
            severity: 'error',
            occurredAt: '2026-01-01T00:00:00+08:00',
            dedupKey: 'custom',
        });
        expect(event.payload).toBe(envelope);
        expect(event.dedupKey).toBe('custom');
        expect(event.severity).toBe('error');
        expect(event.source.producer).toBe('other');
        expect(event.summary).not.toContain('draftId=');
        expect(event.title).toContain('L'.slice(0, 8));
    });

    it('buildDeskObsDumpIntake', () => {
        const envelope = buildIntakePayloadEnvelope({
            index: { purpose: 'full_dump' },
            blocks: [],
        });
        const event = buildDeskObsDumpIntake({
            lineageId: 'line-1',
            underlying: 'AAPL',
            primaryRepo: 'workers-world/x',
            payloadEnvelope: envelope,
            links: [],
        });
        expect(event.kind).toBe(INTAKE_KIND_DESK_OBS_DUMP);
        expect(event.dedupKey).toBe(buildDeskObsDumpDedupKey('line-1'));
        expect(event.payload).toBe(envelope);
        expect(validateIntakeEvent(event)).toBeNull();

        const customDay = buildDeskObsDumpDedupKey('line-1', '2026-01-02');
        expect(customDay).toBe('desk.obs_dump:line-1:dump:2026-01-02');
        const overridden = buildDeskObsDumpIntake({
            producer: 'p',
            lineageId: 'line-1',
            payloadEnvelope: envelope,
            dedupKey: 'd',
            severity: 'warn',
            occurredAt: 't',
        });
        expect(overridden.dedupKey).toBe('d');
        expect(overridden.title).toContain('line-1'.slice(0, 8));
    });
});
