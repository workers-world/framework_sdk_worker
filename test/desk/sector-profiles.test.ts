import { describe, expect, it } from 'vitest';
import {
    getSectorProfile,
    listSectorProfiles,
    matchSectorsInQuestion,
    sectorLexicon,
} from '../../src/desk/sector-profiles.js';

describe('listSectorProfiles / getSectorProfile', () => {
    it('returns the four configured sectors', () => {
        const codes = listSectorProfiles().map((p) => p.sectorCode);
        expect(codes).toEqual(['gold', 'oil', 'tech', 'baijiu']);
        expect(listSectorProfiles()).toBe(listSectorProfiles());
    });

    it('looks up by case-insensitive trimmed code', () => {
        expect(getSectorProfile(' GOLD ')?.displayName).toBe('黄金');
        expect(getSectorProfile('Tech')?.worldviewThemeId).toBe('tech_ai_cycle');
        expect(getSectorProfile('unknown')).toBeUndefined();
        expect(getSectorProfile('')).toBeUndefined();
    });
});

describe('sectorLexicon', () => {
    it('returns lexicon or empty for unknown', () => {
        expect(sectorLexicon('gold')).toContain('黄金');
        expect(sectorLexicon('missing')).toEqual([]);
    });
});

describe('matchSectorsInQuestion', () => {
    it('returns empty for blank question', () => {
        expect(matchSectorsInQuestion('')).toEqual([]);
        expect(matchSectorsInQuestion('   ')).toEqual([]);
    });

    it('matches gold and oil lexicons independently', () => {
        expect(matchSectorsInQuestion('今天黄金怎么样')).toEqual(['gold']);
        expect(matchSectorsInQuestion('OPEC 原油库存')).toContain('oil');
        expect(matchSectorsInQuestion('茅台批价')).toEqual(['baijiu']);
    });

    it('can hit multiple sectors and de-duplicates', () => {
        const hits = matchSectorsInQuestion('黄金与 NVDA 半导体');
        expect(hits).toContain('gold');
        expect(hits).toContain('tech');
        expect(new Set(hits).size).toBe(hits.length);
    });

    it('ignores lexicon terms shorter than 2 chars', () => {
        expect(matchSectorsInQuestion('a')).toEqual([]);
    });
});
