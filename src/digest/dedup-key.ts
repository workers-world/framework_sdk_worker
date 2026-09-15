/**
 * Digest dedup key 规范：digest|{definitionId}|{periodKey}
 */
export function buildDigestDedupKey(definitionId: string, periodKey: string): string {
    return `digest|${definitionId}|${periodKey}`;
}
