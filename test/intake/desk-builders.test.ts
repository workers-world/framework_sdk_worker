import { describe, expect, it } from 'vitest';
import {
    buildQualityArtifactDedupKey,
    buildQualityArtifactIntake,
} from '../../src/intake/builders.js';
import {
    INTAKE_KIND_DESK_DRAFT_QUALITY,
    INTAKE_KIND_DESK_OBS_DUMP,
    INTAKE_KIND_QUALITY_ARTIFACT,
} from '../../src/intake/kinds.js';
import { buildIntakePayloadEnvelope } from '../../src/intake/payload-envelope.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';

describe('desk builders removed from sdk', () => {
    it('does not export buildDeskDraftQualityDedupKey from intake index', async () => {
        const intake = await import('../../src/intake/index.js');
        expect(intake).not.toHaveProperty('buildDeskDraftQualityDedupKey');
        expect(intake).not.toHaveProperty('buildDeskDraftQualityIntake');
        expect(intake).not.toHaveProperty('buildDeskObsDumpDedupKey');
        expect(intake).not.toHaveProperty('buildDeskObsDumpIntake');
        expect(intake).toHaveProperty('buildIntakeDedupKey');
    });
});

describe('buildQualityArtifactIntake desk kindOverride', () => {
    const envelope = buildIntakePayloadEnvelope({
        index: { storyId: 'L' },
        blocks: [],
    });

    it('uses generic quality.artifact dedup when dedupKey omitted (no desk formula)', () => {
        const lite = buildQualityArtifactIntake({
            worker: 'decision-desk-worker',
            artifactType: 'desk.draft',
            mode: 'lite',
            storyId: 'line-1',
            reason: 'thin',
            payloadEnvelope: envelope,
            kindOverride: INTAKE_KIND_DESK_DRAFT_QUALITY,
        });
        expect(lite.kind).toBe(INTAKE_KIND_DESK_DRAFT_QUALITY);
        expect(lite.dedupKey).toBe(
            buildQualityArtifactDedupKey({
                worker: 'decision-desk-worker',
                artifactType: 'desk.draft',
                storyId: 'line-1',
                mode: 'lite',
                reason: 'thin',
            }),
        );
        expect(lite.dedupKey).not.toMatch(/^desk\.draft_quality:line-1:thin:/);
        expect(validateIntakeEvent(lite)).toBeNull();

        const dump = buildQualityArtifactIntake({
            worker: 'decision-desk-worker',
            artifactType: 'desk.draft',
            mode: 'dump',
            storyId: 'line-1',
            payloadEnvelope: envelope,
            kindOverride: INTAKE_KIND_DESK_OBS_DUMP,
        });
        expect(dump.kind).toBe(INTAKE_KIND_DESK_OBS_DUMP);
        expect(dump.dedupKey).toBe(
            buildQualityArtifactDedupKey({
                worker: 'decision-desk-worker',
                artifactType: 'desk.draft',
                storyId: 'line-1',
                mode: 'dump',
            }),
        );
        expect(dump.dedupKey).not.toMatch(/^desk\.obs_dump:line-1:dump:/);
    });

    it('honors explicit dedupKey for desk kind aliases', () => {
        const event = buildQualityArtifactIntake({
            worker: 'decision-desk-worker',
            artifactType: 'desk.draft',
            mode: 'lite',
            storyId: 'line-1',
            reason: 'data_bad',
            payloadEnvelope: envelope,
            kindOverride: INTAKE_KIND_DESK_DRAFT_QUALITY,
            dedupKey: 'desk.draft_quality:data_bad:518880',
        });
        expect(event.dedupKey).toBe('desk.draft_quality:data_bad:518880');
        expect(event.kind).toBe(INTAKE_KIND_DESK_DRAFT_QUALITY);
    });

    it('default kind remains quality.artifact', () => {
        const event = buildQualityArtifactIntake({
            worker: 'w',
            artifactType: 't',
            mode: 'lite',
            storyId: 's',
            reason: 'r',
            payloadEnvelope: envelope,
        });
        expect(event.kind).toBe(INTAKE_KIND_QUALITY_ARTIFACT);
    });
});
