import { describe, expect, it, vi } from 'vitest';
import {
    QUALITY_SLO_BINDING,
    QUALITY_SLO_DATASET,
    type QualitySloDataset,
    recordQualitySample,
} from '../../src/observability/quality-sample.js';

function fakeDataset(): { ds: QualitySloDataset; write: ReturnType<typeof vi.fn> } {
    const write = vi.fn();
    return { ds: { writeDataPoint: write }, write };
}

describe('recordQualitySample', () => {
    it('no-ops when binding missing', () => {
        expect(() =>
            recordQualitySample(undefined, {
                service: 'llm-gateway-worker',
                kind: 'llm.chat',
                because: 'ok',
                latencyMs: 12,
                ok: true,
            }),
        ).not.toThrow();
    });

    it('writes fixed column order', () => {
        const { ds, write } = fakeDataset();
        recordQualitySample(ds, {
            service: 'decision-desk-worker',
            kind: 'llm.desk',
            because: 'llm_failed',
            route: 'draft-gen',
            latencyMs: 340,
            ok: false,
            extra: 2,
        });
        expect(write).toHaveBeenCalledOnce();
        expect(write.mock.calls[0][0]).toEqual({
            indexes: ['decision-desk-worker'],
            blobs: ['llm.desk', 'llm_failed', 'draft-gen'],
            doubles: [340, 0, 2],
        });
    });

    it('treats ok=true as double2=1 and clips index to 96 bytes', () => {
        const { ds, write } = fakeDataset();
        const long = 's'.repeat(200);
        recordQualitySample(ds, {
            service: long,
            kind: 'llm.chat',
            because: 'ok',
            latencyMs: -3,
            ok: true,
        });
        const point = write.mock.calls[0][0] as {
            indexes: string[];
            doubles: number[];
        };
        expect(new TextEncoder().encode(point.indexes[0]).length).toBeLessThanOrEqual(96);
        expect(point.doubles).toEqual([0, 1, 0]);
    });

    it('fail-open when writeDataPoint throws', () => {
        const ds: QualitySloDataset = {
            writeDataPoint: () => {
                throw new Error('boom');
            },
        };
        expect(() =>
            recordQualitySample(ds, {
                service: 'llm-gateway-worker',
                kind: 'llm.chat',
                because: 'ok',
                latencyMs: 1,
                ok: true,
            }),
        ).not.toThrow();
    });
});

describe('QUALITY_SLO constants', () => {
    it('binding and dataset names stay lockstep with wrangler', () => {
        expect(QUALITY_SLO_BINDING).toBe('AE_QUALITY_SLO');
        expect(QUALITY_SLO_DATASET).toBe('quality_slo');
    });
});
