import { describe, expect, it, vi } from 'vitest';
import {
    extractLandingPageVisibleCopy,
    fetchPageMeta,
    fetchProductLandingSnippet,
    formatPageMetaSnippet,
    formatProductLandingSnippet,
    hasUsablePageMeta,
    isCreativeContentPageMeta,
    isPublicFetchDestination,
    isPublicFetchUrl,
    parsePageMetaFromHtml,
    resolvePublicFetchAddresses,
} from '../../src/http/fetch-page-meta.js';
import { createFetchImplWithDns, dnsJsonResponseForType } from './dns-fetch-mock.js';

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

const IMPULSE_LANDING_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Impulse Tracker - ovidem</title>
  <meta property="og:site_name" content="ovidem" />
  <meta property="og:title" content="ovidem">
  <meta property="og:description" content="Impulse Tracker, short story written by Ovi Demetrian Jr.">
</head>
<body>
  <main class="container">
    <h1>Impulse Tracker</h1>
    <p class="subtitle">To do the big things in life, you have to pay attention to each beat along the way</p>
    <p>On a quiet night in the year 1996, 20-year old Alan is in his small apartment, about to make an important life decision.</p>
    <p><em>Short story, about 8 pages</em></p>
    <p><a href="/impulse-tracker.html"><strong>Read it for free</strong></a></p>
  </main>
</body>
</html>`;

describe('extractLandingPageVisibleCopy', () => {
    it('extracts synopsis from main blocks', () => {
        const text = extractLandingPageVisibleCopy(IMPULSE_LANDING_HTML);
        expect(text).toContain('Impulse Tracker');
        expect(text).toContain('1996');
        expect(text).toContain('Short story, about 8 pages');
        expect(text).toContain('Read it for free');
    });
});

describe('formatProductLandingSnippet', () => {
    it('marks creative landing pages and includes visible copy', () => {
        const meta = parsePageMetaFromHtml(IMPULSE_LANDING_HTML);
        const visible = extractLandingPageVisibleCopy(IMPULSE_LANDING_HTML);
        const snippet = formatProductLandingSnippet(meta, visible);
        expect(isCreativeContentPageMeta(meta)).toBe(true);
        expect(snippet).toContain('类型：创作推广');
        expect(snippet).toContain('页面可见文案：');
        expect(snippet).toContain('Short story, about 8 pages');
    });
});

describe('isPublicFetchUrl', () => {
    it('allows public https hosts', () => {
        expect(isPublicFetchUrl(new URL('https://example.com/path'))).toBe(true);
    });

    it('blocks loopback, private, and metadata hosts', () => {
        expect(isPublicFetchUrl(new URL('http://127.0.0.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://localhost/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://192.168.1.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://169.254.169.254/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://metadata.google.internal/'))).toBe(false);
    });

    it('blocks IPv4-mapped IPv6 in hex form (bypass regression)', () => {
        // ::ffff:7f00:1 == 127.0.0.1；曾因 slice 后非 dotted-quad 而放行
        expect(isPublicFetchUrl(new URL('http://[::ffff:7f00:1]/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://[::ffff:0a00:0001]/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://[::ffff:10.0.0.1]/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://[0:0:0:0:0:ffff:10.0.0.1]/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://[0:0:0:0:0:ffff:c0a8:0001]/'))).toBe(false);
    });

    it('allows public IPv4-mapped IPv6 and real public IPv6', () => {
        expect(isPublicFetchUrl(new URL('http://[::ffff:8.8.8.8]/'))).toBe(true);
        expect(isPublicFetchUrl(new URL('http://[::ffff:808:808]/'))).toBe(true);
        expect(isPublicFetchUrl(new URL('http://[2606:4700:4700::1111]/'))).toBe(true);
    });

    it('blocks multicast, reserved, benchmark, and TEST-NET ranges', () => {
        expect(isPublicFetchUrl(new URL('http://224.0.0.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://239.255.255.250/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://240.0.0.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://255.255.255.255/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://198.18.0.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://198.19.255.255/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://192.0.0.1/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://192.0.2.9/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://198.51.100.7/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://203.0.113.5/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://0.0.0.0/'))).toBe(false);
        expect(isPublicFetchUrl(new URL('http://100.64.0.1/'))).toBe(false);
    });

    it('still allows normal public IPv4 literals', () => {
        expect(isPublicFetchUrl(new URL('http://1.1.1.1/'))).toBe(true);
        expect(isPublicFetchUrl(new URL('http://8.8.8.8/'))).toBe(true);
    });
});

describe('resolvePublicFetchAddresses', () => {
    it('rejects hostnames that resolve to private addresses', async () => {
        const fetchFn = vi.fn((input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('type=1')) {
                return Promise.resolve(dnsJsonResponseForType(['127.0.0.1'], 1));
            }
            return Promise.resolve(dnsJsonResponseForType([], 28));
        });

        expect(await resolvePublicFetchAddresses('rebind.example', fetchFn)).toBeNull();
    });

    it('accepts hostnames that resolve only to public addresses', async () => {
        const fetchFn = vi.fn((input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('type=1')) {
                return Promise.resolve(dnsJsonResponseForType(['93.184.216.34'], 1));
            }
            return Promise.resolve(dnsJsonResponseForType([], 28));
        });

        expect(await resolvePublicFetchAddresses('example.com', fetchFn)).toEqual([
            '93.184.216.34',
        ]);
    });
});

describe('isPublicFetchDestination', () => {
    it('blocks public-looking hostnames that resolve to loopback', async () => {
        const fetchFn = vi.fn((input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('type=1')) {
                return Promise.resolve(dnsJsonResponseForType(['127.0.0.1'], 1));
            }
            return Promise.resolve(dnsJsonResponseForType([], 28));
        });

        expect(await isPublicFetchDestination(new URL('https://rebind.example/'), fetchFn)).toBe(
            false,
        );
    });
});

describe('fetchPageMeta', () => {
    it('parses html from fetchImpl', async () => {
        const fetchImpl = createFetchImplWithDns(
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
        const notOk = createFetchImplWithDns(new Response('x', { status: 403 }));
        expect(await fetchPageMeta('https://example.com/', { fetchImpl: notOk })).toEqual({
            source: 'none',
        });

        const pdf = createFetchImplWithDns(
            new Response('%PDF', {
                status: 200,
                headers: { 'content-type': 'application/pdf' },
            }),
        );
        expect(await fetchPageMeta('https://example.com/a', { fetchImpl: pdf })).toEqual({
            source: 'none',
        });
    });

    it('blocks private hosts without fetching', async () => {
        const fetchImpl = vi.fn();
        expect(await fetchPageMeta('http://127.0.0.1/admin', { fetchImpl })).toEqual({
            source: 'none',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not follow redirects to private hosts', async () => {
        const fetchImpl = vi
            .fn()
            .mockImplementationOnce((input: string | URL | Request) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('cloudflare-dns.com/dns-query')) {
                    const parsed = new URL(url);
                    const type = parsed.searchParams.get('type');
                    if (type === '1') {
                        return Promise.resolve(dnsJsonResponseForType(['93.184.216.34'], 1));
                    }
                    return Promise.resolve(dnsJsonResponseForType([], 28));
                }
                return Promise.resolve(
                    new Response('', {
                        status: 302,
                        headers: { location: 'http://127.0.0.1/secret' },
                    }),
                );
            })
            .mockResolvedValue(
                new Response(SAMPLE_HTML, {
                    status: 200,
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                }),
            );

        expect(await fetchPageMeta('https://example.com/redirect', { fetchImpl })).toEqual({
            source: 'none',
        });
        expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('127.0.0.1'))).toBe(false);
    });

    it('blocks hostnames that resolve to private addresses without page fetch', async () => {
        const fetchImpl = vi.fn((input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('cloudflare-dns.com/dns-query')) {
                const parsed = new URL(url);
                const type = parsed.searchParams.get('type');
                if (type === '1') {
                    return Promise.resolve(dnsJsonResponseForType(['127.0.0.1'], 1));
                }
                return Promise.resolve(dnsJsonResponseForType([], 28));
            }
            return Promise.resolve(
                new Response(SAMPLE_HTML, {
                    status: 200,
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                }),
            );
        });

        expect(await fetchPageMeta('https://rebind.example/admin', { fetchImpl })).toEqual({
            source: 'none',
        });
        expect(
            fetchImpl.mock.calls.some(([url]) => String(url).includes('rebind.example/admin')),
        ).toBe(false);
    });
});

describe('fetchProductLandingSnippet', () => {
    it('merges meta and visible copy in one fetch', async () => {
        const fetchImpl = createFetchImplWithDns(
            new Response(IMPULSE_LANDING_HTML, {
                status: 200,
                headers: { 'content-type': 'text/html; charset=utf-8' },
            }),
        );
        const result = await fetchProductLandingSnippet('https://ovidem.com/impulsetracker/', {
            fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        const pageFetches = fetchImpl.mock.calls.filter(
            ([url]) => !String(url).includes('cloudflare-dns.com'),
        );
        expect(pageFetches).toHaveLength(1);
        expect(result.meta.description).toContain('short story');
        expect(result.snippet).toContain('类型：创作推广');
        expect(result.snippet).toContain('页面可见文案：');
        expect(result.snippet).toContain('Read it for free');
    });
});
