import { describe, expect, it } from 'vitest';
import {
    buildIntakeDedupKey,
    joinIntakeDedupKeyParts,
    normalizeIntakeDedupSegment,
} from '../../src/intake/dedup-key.js';
import { shanghaiYmdDash } from '../../src/time.js';

describe('intake dedup-key helpers', () => {
    it('normalizeIntakeDedupSegment trims and collapses whitespace', () => {
        expect(normalizeIntakeDedupSegment('  a  b \n c  ')).toBe('a b c');
        expect(normalizeIntakeDedupSegment('')).toBe('');
    });

    it('joinIntakeDedupKeyParts drops empty segments', () => {
        expect(joinIntakeDedupKeyParts('desk.draft_quality', '  r  ', '', 'seg')).toBe(
            'desk.draft_quality:r:seg',
        );
    });

    it('buildIntakeDedupKey stable vs shanghai day bucket', () => {
        expect(buildIntakeDedupKey('desk.draft_quality', ['data_bad', '518880'])).toBe(
            'desk.draft_quality:data_bad:518880',
        );
        expect(
            buildIntakeDedupKey('desk.obs_dump', ['line-1', 'dump'], {
                strategy: 'shanghai',
                date: '2026-01-02',
            }),
        ).toBe('desk.obs_dump:line-1:dump:2026-01-02');
        expect(
            buildIntakeDedupKey('k', ['a'], { strategy: 'shanghai' }).endsWith(shanghaiYmdDash()),
        ).toBe(true);
    });
});
