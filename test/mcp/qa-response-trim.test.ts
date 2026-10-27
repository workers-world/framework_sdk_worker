import { describe, expect, it } from 'vitest';
import {
    maybeTrimDigestsResponse,
    maybeTrimEventsResponse,
    maybeTrimWorldviewResponse,
    trimEventForQa,
    trimThemeForQa,
} from '../../src/mcp/qa-response-trim.js';

describe('qa-response-trim', () => {
    it('trimEventForQa 截断 aiSummary 并转 date', () => {
        const long = 'x'.repeat(250);
        const out = trimEventForQa({
            title: 't',
            aiSummary: long,
            createdAt: 1_700_000_000,
            link: 'https://example.com',
        });
        expect(out.title).toBe('t');
        expect(String(out.aiSummary).endsWith('…')).toBe(true);
        expect(out.date).toBe('2023-11-14');
        expect(out.link).toBeUndefined();
    });

    it('maybeTrimEventsResponse 只裁剪 /v1/events', () => {
        const raw = {
            ok: true,
            items: [{ title: 'a', aiSummary: 's', createdAt: 1_700_000_000 }],
        };
        const trimmed = maybeTrimEventsResponse('/v1/events', raw) as typeof raw;
        expect(trimmed.items[0].date).toBe('2023-11-14');
        expect(maybeTrimEventsResponse('/v1/portfolio', raw)).toBe(raw);
    });

    it('maybeTrimDigestsResponse 裁剪 digests', () => {
        const raw = {
            ok: true,
            items: [{ title: 'd', summary: 'hello', createdAt: '2026-08-25T10:00:00+08:00' }],
        };
        const trimmed = maybeTrimDigestsResponse('/v1/digests', raw) as {
            items: Array<{ date?: string }>;
        };
        expect(trimmed.items[0].date).toBe('2026-08-25');
    });

    it('maybeTrimWorldviewResponse 裁剪 themes', () => {
        const raw = {
            ok: true,
            worldview: {
                version: 1,
                themes: [{ topic: '黄金', thesis: '看多', stance: 'bull', symbolsTouched: ['x'] }],
            },
        };
        const trimmed = maybeTrimWorldviewResponse('/v1/worldview', raw) as typeof raw;
        expect(trimmed.worldview.themes[0].topic).toBe('黄金');
        const detail = maybeTrimWorldviewResponse('/v1/worldview/themes/t1', {
            ok: true,
            theme: trimThemeForQa({
                topic: 't',
                thesis: 'th',
                stance: 'watch',
                symbolsTouched: [],
            }),
        }) as { theme: { topic: string } };
        expect(detail.theme.topic).toBe('t');
    });
});
