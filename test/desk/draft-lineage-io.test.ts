import { describe, expect, it } from 'vitest';
import {
    createDraftLineageEnvelope,
    newLineageEventId,
    resolvePrimaryLineageId,
    STREAM_DRAFT_LINEAGE,
} from '../../src/desk/draft-lineage-io.js';
import { matchSectorsInQuestion } from '../../src/desk/sector-profiles.js';

describe('draft-lineage-io', () => {
    it('createDraftLineageEnvelope uses lifecycle stream', () => {
        const eventId = newLineageEventId();
        const env = createDraftLineageEnvelope({
            lineageId: 'line-1',
            eventId,
            source: '/workers/decision-desk',
            action: 'draft.inserted',
            wwsummary: 'test',
            data: { underlying: '518880', draftId: 1 },
        });
        expect(env.wwstream).toBe(STREAM_DRAFT_LINEAGE);
        expect(env.wwcategory).toBe('lifecycle');
        expect(env.type).toBe('workers-world.desk.draft.draft.inserted');
        expect(env.id).toBe(`line-1:${eventId}`);
    });

    it('resolvePrimaryLineageId picks first trace', () => {
        expect(resolvePrimaryLineageId(['a', 'b'], 'fallback')).toBe('a');
        expect(resolvePrimaryLineageId([], 'fallback')).toBe('fallback');
    });
});

describe('sector-profiles', () => {
    it('matchSectorsInQuestion hits gold', () => {
        expect(matchSectorsInQuestion('今天黄金怎么样')).toContain('gold');
    });
});
