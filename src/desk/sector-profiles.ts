/**
 * Sector Profile 单一配置源：market-qa 选材 / decision-desk sector_code 对齐。
 */
import profilesJson from './sector-profiles.json' with { type: 'json' };

export type SectorProfile = {
    sectorCode: string;
    displayName: string;
    lexicon: string[];
    worldviewThemeId?: string;
    promptFragment?: string;
    deskUnderlyingFilter?: string[];
};

const PROFILES: SectorProfile[] = profilesJson as SectorProfile[];

export function listSectorProfiles(): readonly SectorProfile[] {
    return PROFILES;
}

export function getSectorProfile(sectorCode: string): SectorProfile | undefined {
    const key = sectorCode.trim().toLowerCase();
    return PROFILES.find((p) => p.sectorCode.toLowerCase() === key);
}

/** 按问题文本命中板块（可多命中，compare 用） */
export function matchSectorsInQuestion(question: string): string[] {
    const q = question.trim().toLowerCase();
    if (!q) {
        return [];
    }
    const hits: string[] = [];
    for (const p of PROFILES) {
        const matched = p.lexicon.some((term) => {
            const t = term.trim().toLowerCase();
            return t.length >= 2 && q.includes(t);
        });
        if (matched) {
            hits.push(p.sectorCode);
        }
    }
    return [...new Set(hits)];
}

export function sectorLexicon(sectorCode: string): string[] {
    return getSectorProfile(sectorCode)?.lexicon ?? [];
}
