/**
 * 三通道 + finalize 后 hop 期望：防止回归绕过发布闸。
 */
import { describe, expect, it } from 'vitest';
import { buildOpsErrorIntake } from '../../src/intake/builders.js';
import { payloadHasHopPointer } from '../../src/intake/hop-meta.js';
import { isIntakePayloadEnvelope } from '../../src/intake/payload-envelope.js';
import { intakePlatformAssembleUncaughtException } from '../../src/intake/platform-assemble.js';
import {
    INTAKE_PRODUCER_CHANNEL_ARTIFACT,
    INTAKE_PRODUCER_CHANNEL_OPS,
    INTAKE_PRODUCER_CHANNEL_PLATFORM,
    intakePublishFinalize,
} from '../../src/intake/publish.js';

const CHANNELS = [
    INTAKE_PRODUCER_CHANNEL_OPS,
    INTAKE_PRODUCER_CHANNEL_ARTIFACT,
    INTAKE_PRODUCER_CHANNEL_PLATFORM,
] as const;

describe('IntakeProducerChannel registry', () => {
    it('exports three mutually exclusive channels', () => {
        expect(new Set(CHANNELS).size).toBe(3);
    });
});

describe('ops / platform assemble → finalize hop', () => {
    it('ops.error with hop context has pointer after finalize', () => {
        const event = buildOpsErrorIntake({
            producer: 'w',
            worker: 'w',
            reason: 'r',
            error: 'e',
        });
        const finalized = intakePublishFinalize(event, {
            channel: 'ops',
            hop: { requestId: 'OPS-HOP' },
        });
        expect(payloadHasHopPointer(finalized.payload)).toBe(true);
    });

    it('platform uncaught exception assemble is v2 and accepts hop via finalize', () => {
        const event = intakePlatformAssembleUncaughtException({
            worker: 'email-rule-worker',
            error: 'Error: boom',
            context: { path: '/x' },
        });
        expect(isIntakePayloadEnvelope(event.payload)).toBe(true);
        const finalized = intakePublishFinalize(event, {
            channel: 'platform',
            hop: { invocationId: 'TAIL-1' },
        });
        expect(payloadHasHopPointer(finalized.payload)).toBe(true);
    });
});
