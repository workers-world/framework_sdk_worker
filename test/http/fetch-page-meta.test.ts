import { describe, expect, it, vi } from 'vitest';
import {
    fetchPageMeta,
    formatPageMetaSnippet,
    hasUsablePageMeta,
    parsePageMetaFromHtml,
} from '../../src/http/fetch-page-meta.js';

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Pixy &amp; Co</title>
  <meta property="og:title" content="Pixy — visual editor" />
  <meta property="og:description" content="Figma for coding agents on your live site." />
  <meta property="og:site_name" content="Pixy" />
  <meta name="description" content="fallback desc" />
</head>
<body><h1>Hello</h1></body>
</html>`;

describe('parsePageMetaFromHtml', () => {
    it('prefers og tags', () => {
        const meta = parsePageMetaFromHtml(SAMPLE_HTML);
        expect(meta.source).toBe('og');
        expect(meta.title).toBe('Pixy — visual editor');
        expect(meta.description).toBe('Figma for coding agents on your live site.');
        expect(meta.siteName).toBe('Pixy');
        expect(hasUsablePageMeta(meta)).toBe(true);
    });

    it('falls back to name=description then title', () => {
        const metaOnly = parsePageMetaFromHtml(
            '<meta name="description" content="Only meta"><title>T</title>',
        );
        expect(metaOnly.source).toBe('meta');
        expect(metaOnly.description).toBe('Only meta');
        expect(metaOnly.title).toBe('T');

        const titleOnly = parsePageMetaFromHtml('<title>Just Title</title>');
        expect(titleOnly.source).toBe('title');
        expect(titleOnly.title).toBe('Just Title');
        expect(hasUsablePageMeta(titleOnly)).toBe(true);
    });

    it('returns none for empty html', () => {
        expect(parsePageMetaFromHtml('')).toEqual({ source: 'none' });
        expect(hasUsablePageMeta({ source: 'none' })).toBe(false);
    });
});

describe('formatPageMetaSnippet', () => {
    it('formats structured lines', () => {
        const text = formatPageMetaSnippet({
            source: 'og',
            title: 'Pixy',
            description: 'visual editor',
            siteName: 'Pixy',
        });
        expect(text).toContain('产品落地页元信息');
        expect(text).toContain('站点：Pixy');
        expect(text).toContain('标题：Pixy');
        expect(text).toContain('描述：visual editor');
        expect(text).toContain('来源：og');
    });
});

describe('fetchPageMeta', () => {
    it('parses html from fetchImpl', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(SAMPLE_HTML, {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        );
        const meta = await fetchPageMeta('https://pixydesignapp.com/', { fetchImpl });
        expect(meta.source).toBe('og');
        expect(meta.description).toContain('coding agents');
    });

    it('returns none on non-ok or pdf content-type', async () => {
        const notOk = vi.fn().mockResolvedValue(new Response('x', { status: 403 }));
        expect(await fetchPageMeta('https://example.com/', { fetchImpl: notOk })).toEqual({
            source: 'none',
        });

        const pdf = vi.fn().mockResolvedValue(
            new Response('%PDF', {
                status: 200,
                headers: { 'content-type': 'application/pdf' },
            }),
        );
        expect(await fetchPageMeta('https://example.com/a', { fetchImpl: pdf })).toEqual({
            source: 'none',
        });
    });
});
