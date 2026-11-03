/**
 * Generic Intake `dedupKey` mechanics (no business-specific formulas).
 *
 * Conventions:
 * - Every {@link IntakeEvent} must carry a non-empty `dedupKey`; validate via `validateIntakeEvent`.
 * - sch1 intake upsert merges rows on `dedup_key` collision (increments hit count) — stable keys
 *   collapse chronic repeats; day-bucket keys roll forward daily.
 * - **Producers own domain dedup formulas** (e.g. decision-desk draft quality). Pass explicit
 *   `dedupKey` on `submitQualityArtifact*` / builders; SDK defaults are kind-generic only.
 */
import { shanghaiYmdDash } from '../time.js';

/** Trim and collapse whitespace so segment text is stable across formatting drift. */
export function normalizeIntakeDedupSegment(segment: string): string {
    return segment.trim().replace(/\s+/g, ' ');
}

/** Join non-empty normalized segments with `:`. */
export function joinIntakeDedupKeyParts(...parts: string[]): string {
    return parts
        .map(normalizeIntakeDedupSegment)
        .filter((p) => p.length > 0)
        .join(':');
}

export type IntakeDedupDayBucket = { strategy: 'none' } | { strategy: 'shanghai'; date?: string };

/**
 * Colon-joined dedup key: `{prefix}:{segments…}` with optional Shanghai calendar day suffix.
 */
export function buildIntakeDedupKey(
    prefix: string,
    segments: string[],
    dayBucket: IntakeDedupDayBucket = { strategy: 'none' },
): string {
    const core = joinIntakeDedupKeyParts(prefix, ...segments);
    if (dayBucket.strategy === 'shanghai') {
        const day = dayBucket.date ?? shanghaiYmdDash();
        return joinIntakeDedupKeyParts(core, day);
    }
    return core;
}
