/** 归一化 error 文本，便于 dedupKey 稳定 */
export function normalizeError(error: string): string {
    return error
        .trim()
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
        .replace(/\b\d{10,}\b/g, '<id>')
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>');
}

/** 简单稳定 hash（FNV-1a 32-bit） */
export function hashString(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildOpsDedupKey(
    worker: string,
    reason: string,
    error: string,
): string {
    const normalized = normalizeError(error);
    return `ops:${worker}:${reason}:${hashString(normalized)}`;
}
