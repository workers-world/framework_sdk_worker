import { describe, expect, it } from 'vitest';
import {
    hasIntakeHopMeta,
    intakeMergeHopMeta,
    intakeMergeHopMetaIntoEvent,
    normalizeHopRequestId,
    payloadHasHopPointer,
} from '../../src/intake/hop-meta.js';
import {
    INTAKE_BLOCK_OBSERVABILITY_REF,
    isIntakePayloadEnvelope,
} from '../../src/intake/payload-envelope.js';
import type { IntakeEvent } from '../../src/intake/types.js';

describe('normalizeHopRequestId', () => {
    it('prefers invocationId over requestId', () => {
        expect(normalizeHopRequestId({ invocationId: 'inv-1', requestId: 'req-1' })).toBe('inv-1');
        expect(normalizeHopRequestId({ requestId: 'req-1' })).toBe('req-1');
        expect(normalizeHopRequestId({})).toBeUndefined();
    });
});

describe('intakeMergeHopMeta', () => {
    it('upgrades flat payload to v2 with obs block', () => {
        const merged = intakeMergeHopMeta({ worker: 'tal1', reason: 'x' }, { requestId: 'ABC123' });
        expect(isIntakePayloadEnvelope(merged)).toBe(true);
        if (!isIntakePayloadEnvelope(merged)) {
            return;
        }
        expect(merged.index.requestId).toBe('ABC123');
        expect(merged.blocks.some((b) => b.type === INTAKE_BLOCK_OBSERVABILITY_REF)).toBe(true);
    });

    it('does not duplicate obs block for same requestId', () => {
        const once = intakeMergeHopMeta(
            {
                payloadVersion: 2,
                index: { worker: 'w' },
                blocks: [],
            },
            { requestId: 'R1' },
        );
        const twice = intakeMergeHopMeta(once, { requestId: 'R1' });
        if (!isIntakePayloadEnvelope(twice)) {
            throw new Error('expected envelope');
        }
        const obs = twice.blocks.filter((b) => b.type === INTAKE_BLOCK_OBSERVABILITY_REF);
        expect(obs).toHaveLength(1);
    });

    it('no-ops when hop empty', () => {
        const payload = { a: 1 };
        expect(intakeMergeHopMeta(payload, {})).toBe(payload);
        expect(hasIntakeHopMeta({})).toBe(false);
    });
});

describe('intakeMergeHopMetaIntoEvent / payloadHasHopPointer', () => {
    it('marks hop pointer after merge', () => {
        const event: IntakeEvent = {
            schemaVersion: 1,
            kind: 'ops.error',
            dedupKey: 'k',
            source: { producer: 't' },
            title: 't',
            summary: 's',
            severity: 'error',
            occurredAt: '2026-10-24T00:00:00+08:00',
            payload: { worker: 't' },
        };
        expect(payloadHasHopPointer(event.payload)).toBe(false);
        const next = intakeMergeHopMetaIntoEvent(event, { invocationId: 'INV' });
        expect(payloadHasHopPointer(next.payload)).toBe(true);
    });
});
