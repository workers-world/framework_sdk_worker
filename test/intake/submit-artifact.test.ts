import { describe, expect, it, vi } from 'vitest';
import {
    buildQualityArtifactDedupKey,
    buildQualityArtifactIntake,
} from '../../src/intake/builders.js';
import {
    INTAKE_KIND_DESK_DRAFT_QUALITY,
    INTAKE_KIND_DESK_OBS_DUMP,
    INTAKE_KIND_QUALITY_ARTIFACT,
} from '../../src/intake/kinds.js';
import {
    buildIntakePayloadEnvelope,
    INTAKE_BLOCK_ARTIFACT_SNAPSHOT,
    isIntakePayloadEnvelope,
} from '../../src/intake/payload-envelope.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';
import {
    buildQualityArtifactEvent,
    submitQualityArtifact,
} from '../../src/intake/submit-artifact.js';
import { shanghaiYmdDash } from '../../src/time.js';

describe('quality artifact builders', () => {
    it('buildQualityArtifactDedupKey', () => {
        expect(
            buildQualityArtifactDedupKey({
                worker: 'w',
                artifactType: 'desk.draft',
                storyId: 'story1',
                mode: 'lite',
                reason: 'empty',
                date: '2026-09-24',
            }),
        ).toBe('quality.artifact:w:desk.draft:story1:empty:2026-09-24');
        expect(
            buildQualityArtifactDedupKey({
                worker: 'w',
                artifactType: 'desk.draft',
                storyId: 'story1',
                mode: 'dump',
                date: '2026-09-24',
            }),
        ).toBe('quality.artifact:w:desk.draft:story1:dump:2026-09-24');
    });

    it('kindOverride keeps desk dedup formulas', () => {
        const envelope = buildIntakePayloadEnvelope({
            index: { storyId: 'L' },
            blocks: [],
        });
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
            `${INTAKE_KIND_DESK_DRAFT_QUALITY}:line-1:thin:${shanghaiYmdDash()}`,
        );
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
        expect(dump.dedupKey).toBe(`${INTAKE_KIND_DESK_OBS_DUMP}:line-1:dump:${shanghaiYmdDash()}`);
    });
});

describe('buildQualityArtifactEvent', () => {
    it('assembles lite envelope with artifact_snapshot', async () => {
        const result = await buildQualityArtifactEvent(
            {},
            {
                worker: 'decision-desk-worker',
                artifactType: 'desk.draft',
                mode: 'lite',
                storyId: 'abc123',
                reason: 'empty_fund',
                snapshot: { draft: { id: 1, underlying: '600519' } },
                primaryRepo: 'workers-world/decision-desk-worker',
                indexExtra: { lineageId: 'abc123', draftId: 1 },
            },
        );
        expect('error' in result).toBe(false);
        if ('error' in result) {
            return;
        }
        expect(result.event.kind).toBe(INTAKE_KIND_QUALITY_ARTIFACT);
        expect(isIntakePayloadEnvelope(result.event.payload)).toBe(true);
        const envelope = result.event.payload as ReturnType<typeof buildIntakePayloadEnvelope>;
        expect(envelope.index.artifactType).toBe('desk.draft');
        expect(envelope.index.mode).toBe('lite');
        expect(envelope.blocks.some((b) => b.type === INTAKE_BLOCK_ARTIFACT_SNAPSHOT)).toBe(true);
        expect(envelope.blocks.some((b) => b.id === 'draft-snapshot')).toBe(true);
    });

    it('dump adds agent inspect markdown; R2 overflow when oversized', async () => {
        const put = vi.fn(async () => undefined);
        const big = Array.from({ length: 200 }, (_, i) => ({
            id: `e-${i}`,
            data: { pad: 'x'.repeat(300) },
        }));
        const result = await buildQualityArtifactEvent(
            { R2_QUALITY_CAPTURE: { put } as never },
            {
                worker: 'w',
                artifactType: 'x.y',
                mode: 'dump',
                storyId: 's1',
                envelopes: big as never,
                primaryRepo: 'workers-world/w',
            },
        );
        expect('error' in result).toBe(false);
        if ('error' in result) {
            return;
        }
        expect(put).toHaveBeenCalled();
        expect(
            result.event.payload.blocks?.some((b: { id?: string }) => b.id === 'agent-inspect') ||
                (result.event.payload as { blocks: Array<{ id: string }> }).blocks.some(
                    (b) => b.id === 'agent-inspect',
                ),
        ).toBe(true);
        const blocks = (
            result.event.payload as { blocks: Array<{ id: string; data?: { r2Key?: string } }> }
        ).blocks;
        expect(blocks.some((b) => b.data?.r2Key?.includes('intake-digest/w/x.y/s1/'))).toBe(true);
    });

    it('rejects lite without reason', async () => {
        const result = await buildQualityArtifactEvent(
            {},
            {
                worker: 'w',
                artifactType: 't',
                mode: 'lite',
                storyId: 's',
            },
        );
        expect(result).toEqual({ error: 'reason required for mode=lite' });
    });
});

describe('submitQualityArtifact', () => {
    it('posts assembled event', async () => {
        const fetchMock = vi.fn(async () => Response.json({ ok: true, id: 9 }));
        const result = await submitQualityArtifact(
            {
                SVC_SCH1: { fetch: fetchMock } as never,
                SCH_INTAKE_TOKEN: 'tok',
            },
            {
                worker: 'w',
                artifactType: 't',
                mode: 'lite',
                storyId: 's',
                reason: 'r',
            },
        );
        expect(result.ok).toBe(true);
        expect(result.id).toBe(9);
        expect(result.kind).toBe(INTAKE_KIND_QUALITY_ARTIFACT);
        expect(fetchMock).toHaveBeenCalled();
    });
});
