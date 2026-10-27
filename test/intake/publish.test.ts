import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpsErrorIntake } from '../../src/intake/builders.js';
import {
    INTAKE_BLOCK_OBSERVABILITY_REF,
    isIntakePayloadEnvelope,
} from '../../src/intake/payload-envelope.js';
import { intakePublish, intakePublishFinalize } from '../../src/intake/publish.js';
import { setActiveInvocationId } from '../../src/observability/worker-invocation-id.js';

describe('intakePublishFinalize', () => {
    afterEach(() => {
        setActiveInvocationId(undefined);
    });

    it('merges hop from context into ops.error event', () => {
        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const finalized = intakePublishFinalize(event, {
            hop: { requestId: 'REQ-99' },
            channel: 'ops',
        });
        expect(isIntakePayloadEnvelope(finalized.payload)).toBe(true);
        if (!isIntakePayloadEnvelope(finalized.payload)) {
            return;
        }
        expect(finalized.payload.index.requestId).toBe('REQ-99');
        expect(
            finalized.payload.blocks.some((b) => b.type === INTAKE_BLOCK_OBSERVABILITY_REF),
        ).toBe(true);
    });

    it('reads active invocation id when hop omitted', () => {
        setActiveInvocationId('ACTIVE-1');
        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const finalized = intakePublishFinalize(event, {});
        if (!isIntakePayloadEnvelope(finalized.payload)) {
            throw new Error('expected envelope');
        }
        expect(finalized.payload.index.requestId).toBe('ACTIVE-1');
    });
});

describe('intakePublish', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        setActiveInvocationId(undefined);
    });

    it('POSTs finalized event with requestId in body', async () => {
        const fetchSpy = vi.fn(
            async () => new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        const event = buildOpsErrorIntake({
            producer: 'test',
            worker: 'test',
            reason: 'boom',
            error: 'err',
        });
        const result = await intakePublish(
            { SCH_INTAKE_URL: 'https://example.com', SCH_INTAKE_TOKEN: 'tok' },
            event,
            { hop: { invocationId: 'INV-POST' } },
        );
        expect(result.ok).toBe(true);
        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(init.body)) as {
            payload: { index: { requestId?: string } };
        };
        expect(body.payload.index.requestId).toBe('INV-POST');
    });
});
