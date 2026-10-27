import { describe, expect, it } from 'vitest';
import {
    cellsFromCalculations,
    compareHintOf,
    groupsFromCountCalculation,
    invocationIdsFromTelemetry,
    isNoisyErrorBurstMessage,
    waitHintOf,
} from '../../src/observability/metric-cell.js';

describe('metric-cell', () => {
    it('joins platform calculation groups into cells', () => {
        const groups = [
            { key: '$workers.scriptName', value: 'notify-worker' },
            { key: '$workers.event.request.path', value: '/v1/send' },
        ];
        const cells = cellsFromCalculations({
            window: { from: 'a', to: 'b' },
            floorMs: 800,
            calculations: [
                { alias: 'n', aggregates: [{ value: 40, groups }] },
                { alias: 'wall_p95', aggregates: [{ value: 1200, groups }] },
                { alias: 'cpu_p50', aggregates: [{ value: 20, groups }] },
            ],
            compare: [{ alias: 'wall_p95', aggregates: [{ value: 400, groups }] }],
        });
        expect(cells).toHaveLength(1);
        expect(cells[0]?.stats.p95).toBe(1200);
        expect(cells[0]?.waitHint).toBe('io');
        expect(cells[0]?.compare).toBe('regression');
        expect(cells[0]?.fingerprint).toBe('opt:notify-worker:/v1/send');
    });

    it('classifies wait and compare hints', () => {
        expect(waitHintOf(100, 90)).toBe('cpu');
        expect(compareHintOf(900, 900, 800)).toBe('chronic');
    });

    it('reads error burst groups from count alias', () => {
        const groups = groupsFromCountCalculation([
            {
                alias: 'n',
                aggregates: [
                    {
                        value: 6,
                        groups: [
                            { key: '$workers.scriptName', value: 'desk' },
                            { key: '$metadata.message', value: 'UNIQUE' },
                        ],
                    },
                ],
            },
        ]);
        expect(groups).toEqual([{ script: 'desk', message: 'UNIQUE', count: 6 }]);
    });

    it('filters cron and log-channel burst fingerprints, keeps D1_ERROR', () => {
        expect(isNoisyErrorBurstMessage('*/5 * * * *')).toBe(true);
        expect(isNoisyErrorBurstMessage('0 1 * * 5')).toBe(true);
        expect(isNoisyErrorBurstMessage('sch1 d1_all ERROR')).toBe(true);
        expect(isNoisyErrorBurstMessage('   ')).toBe(true);
        expect(isNoisyErrorBurstMessage('D1_ERROR: internal error; reference = abc')).toBe(false);
        expect(isNoisyErrorBurstMessage('UNIQUE constraint failed: DESK_DRAFT_LINEAGE_T')).toBe(
            false,
        );
    });

    it('walks invocation ids', () => {
        expect(
            invocationIdsFromTelemetry(
                { traces: [{ invocationId: 'abc' }, { requestId: 'abc' }] },
                5,
            ),
        ).toEqual(['abc']);
    });
});
