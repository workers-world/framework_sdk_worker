import { describe, expect, it } from 'vitest';
import { DEFAULT_FALLBACK_SPEC, filterFallbackSpecByEntries } from '../../src/mcp/fallback-spec.js';
import type { McpServiceEntry } from '../../src/mcp/types.js';

function entry(
    partial: Partial<McpServiceEntry> & Pick<McpServiceEntry, 'matchPrefixes'>,
): McpServiceEntry {
    return {
        worker: 'w',
        svcKey: 'SVC',
        tokenKey: 'TOK',
        baseUrl: 'https://svc',
        ...partial,
    };
}

describe('filterFallbackSpecByEntries', () => {
    it('keeps exact prefix and nested paths', () => {
        const filtered = filterFallbackSpecByEntries([
            entry({
                worker: 'invest-rss-worker',
                matchPrefixes: ['/v1/events'],
                tag: 'events',
                description: 'RSS events',
                baseUrl: 'https://rss',
            }),
        ]);
        expect(filtered.paths?.['/v1/events']).toBeTruthy();
        expect(filtered.paths?.['/v1/events/stats']).toBeTruthy();
        expect(filtered.paths?.['/v1/advice']).toBeUndefined();
        expect(filtered.servers).toEqual([{ url: 'https://rss', description: 'RSS events' }]);
        expect(filtered.tags).toEqual([{ name: 'events', description: 'RSS events' }]);
        expect(filtered.info?.title).toBe('fallback');
    });

    it('falls back to worker name when description missing and skips untagged', () => {
        const filtered = filterFallbackSpecByEntries([
            entry({
                worker: 'notify-worker',
                matchPrefixes: ['/v1/send'],
                baseUrl: 'https://notify',
            }),
        ]);
        expect(filtered.paths?.['/v1/send']).toBeTruthy();
        expect(filtered.servers?.[0]?.description).toBe('notify-worker');
        expect(filtered.tags).toEqual([]);
    });

    it('covers worldview nested id path via prefix', () => {
        const filtered = filterFallbackSpecByEntries([
            entry({ matchPrefixes: ['/v1/worldview'], tag: 'analysis' }),
        ]);
        expect(filtered.paths?.['/v1/worldview']).toBeTruthy();
        expect(filtered.paths?.['/v1/worldview/themes/{id}']).toBeTruthy();
    });

    it('exports a non-empty default spec', () => {
        expect(Object.keys(DEFAULT_FALLBACK_SPEC.paths ?? {}).length).toBeGreaterThan(10);
    });
});
