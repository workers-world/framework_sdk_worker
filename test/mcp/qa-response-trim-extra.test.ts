import { describe, expect, it } from 'vitest';
import {
    maybeTrimDigestsResponse,
    maybeTrimEventsResponse,
    maybeTrimWorldviewResponse,
    trimDigestForQa,
    trimEventForQa,
    trimThemeForQa,
} from '../../src/mcp/qa-response-trim.js';

describe('qa-response-trim extra branches', () => {
    it('passthroughs non-objects and non-matching shapes', () => {
        expect(maybeTrimEventsResponse('/v1/events', null)).toBeNull();
        expect(maybeTrimEventsResponse('/v1/events?x=1', { ok: true })).toEqual({ ok: true });
        expect(maybeTrimDigestsResponse('/v1/digests', 'x')).toBe('x');
        expect(maybeTrimDigestsResponse('/v1/other', { items: [] })).toEqual({ items: [] });
        expect(maybeTrimWorldviewResponse('/v1/worldview', 1)).toBe(1);
        expect(maybeTrimWorldviewResponse('/v1/worldview', { ok: true, worldview: {} })).toEqual({
            ok: true,
            worldview: {},
        });
        expect(maybeTrimWorldviewResponse('/v1/worldview/themes/t1', { ok: true })).toEqual({
            ok: true,
        });
        expect(maybeTrimWorldviewResponse('/v1/else', { ok: true })).toEqual({ ok: true });
    });

    it('maps primitive list items and optional digest fields', () => {
        const events = maybeTrimEventsResponse('/v1/events', {
            ok: true,
            items: ['skip', { title: 't', createdAt: 'bad' }],
        }) as { items: unknown[] };
        expect(events.items[0]).toBe('skip');
        expect((events.items[1] as { date?: string }).date).toBeUndefined();
        expect(trimEventForQa({ title: 't', aiSummary: 1 }).aiSummary).toBe('');

        const digests = maybeTrimDigestsResponse('/v1/digests?limit=1', {
            ok: true,
            items: [
                1,
                {
                    summary: 's'.repeat(250),
                    url: 'https://x',
                    fallback: true,
                    createdAt: 1,
                },
            ],
        }) as { items: Array<Record<string, unknown>> };
        expect(digests.items[0]).toBe(1);
        expect(String(digests.items[1]?.summary).endsWith('…')).toBe(true);
        expect(digests.items[1]?.url).toBe('https://x');
        expect(digests.items[1]?.fallback).toBe(true);

        const themes = maybeTrimWorldviewResponse('/v1/worldview', {
            ok: true,
            worldview: {
                themes: [null, { thesis: 't'.repeat(250), symbolsTouched: 'x' }],
            },
        }) as { worldview: { themes: unknown[] } };
        expect(themes.worldview.themes[0]).toBeNull();
        expect(
            String((themes.worldview.themes[1] as { thesis: string }).thesis).endsWith('…'),
        ).toBe(true);
        expect(
            (themes.worldview.themes[1] as { symbolsTouched: unknown[] }).symbolsTouched,
        ).toEqual([]);
        expect(trimDigestForQa({ summary: 1, fallback: false }).fallback).toBeUndefined();
        expect(trimThemeForQa({ thesis: 1 }).thesis).toBe('');
    });
});
