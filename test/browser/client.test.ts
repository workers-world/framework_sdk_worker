import { describe, expect, it } from 'vitest';
import { runBrowserAction } from '../../src/browser/client.js';

function mockFetcher(
    handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): Fetcher {
    return {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            return handler(url, init);
        },
    } as unknown as Fetcher;
}

describe('runBrowserAction', () => {
    it('returns config error when SVC_BROWSER_RUN missing', async () => {
        const result = await runBrowserAction({}, 'markdown', { url: 'https://example.com' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failReason).toBe('config');
            expect(result.error).toContain('SVC_BROWSER_RUN');
        }
    });

    it('returns config error when token missing', async () => {
        const result = await runBrowserAction(
            { SVC_BROWSER_RUN: mockFetcher(() => new Response('{}')) },
            'markdown',
            { url: 'https://example.com' },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failReason).toBe('config');
            expect(result.error).toContain('BROWSER_RUN_AUTH_TOKEN');
        }
    });

    it('posts Bearer + path for markdown and returns text', async () => {
        let seenUrl = '';
        let auth = '';
        let bodyText = '';
        const result = await runBrowserAction(
            {
                SVC_BROWSER_RUN: mockFetcher((url, init) => {
                    seenUrl = url;
                    auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
                    bodyText = String(init?.body ?? '');
                    return new Response(JSON.stringify({ ok: true, result: '# Hello\n\nWorld' }), {
                        status: 200,
                        headers: {
                            'X-Browser-Ms-Used': '420',
                            'X-Browser-Engine': 'chromium',
                        },
                    });
                }),
                BROWSER_RUN_AUTH_TOKEN: 'tok',
            },
            'markdown',
            {
                url: 'https://example.com',
                gotoOptions: { waitUntil: 'networkidle2', timeout: 20_000 },
                caller: 'mok1:probe',
            },
        );
        expect(seenUrl).toBe('https://browser-run/internal/v1/markdown');
        expect(auth).toBe('Bearer tok');
        expect(JSON.parse(bodyText)).toMatchObject({
            url: 'https://example.com',
            gotoOptions: { waitUntil: 'networkidle2', timeout: 20_000 },
        });
        expect(result).toEqual({
            ok: true,
            action: 'markdown',
            text: '# Hello\n\nWorld',
            engine: 'chromium',
            browserMsUsed: 420,
        });
    });

    it('maps 429 to rate_limit with Retry-After', async () => {
        const result = await runBrowserAction(
            {
                SVC_BROWSER_RUN: mockFetcher(
                    () =>
                        new Response(
                            JSON.stringify({ ok: false, error: 'busy', code: 'rate_limit' }),
                            {
                                status: 429,
                                headers: { 'Retry-After': '30' },
                            },
                        ),
                ),
                BROWSER_RUN_AUTH_TOKEN: 'tok',
            },
            'markdown',
            { url: 'https://example.com' },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failReason).toBe('rate_limit');
            expect(result.status).toBe(429);
            expect(result.retryAfterSec).toBe(30);
        }
    });

    it('maps 422 to render_error', async () => {
        const result = await runBrowserAction(
            {
                SVC_BROWSER_RUN: mockFetcher(
                    () =>
                        new Response(
                            JSON.stringify({ ok: false, error: 'bad page', code: 'render_error' }),
                            { status: 422 },
                        ),
                ),
                BROWSER_RUN_AUTH_TOKEN: 'tok',
            },
            'pdf',
            { html: '<p>hi</p>' },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failReason).toBe('render_error');
            expect(result.status).toBe(422);
        }
    });

    it('returns pdf bytes on success', async () => {
        const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
        const result = await runBrowserAction(
            {
                SVC_BROWSER_RUN: mockFetcher(
                    () =>
                        new Response(pdf, {
                            status: 200,
                            headers: { 'Content-Type': 'application/pdf' },
                        }),
                ),
                BROWSER_RUN_AUTH_TOKEN: 'tok',
            },
            'pdf',
            { html: '<p>hi</p>' },
        );
        expect(result.ok).toBe(true);
        if (result.ok && result.action === 'pdf') {
            expect(result.contentType).toBe('application/pdf');
            expect(new Uint8Array(result.bytes)).toEqual(pdf);
        }
    });

    it('returns network failReason on fetch throw', async () => {
        const result = await runBrowserAction(
            {
                SVC_BROWSER_RUN: mockFetcher(() => {
                    throw new Error('connection reset');
                }),
                BROWSER_RUN_AUTH_TOKEN: 'tok',
            },
            'screenshot',
            { url: 'https://example.com' },
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failReason).toBe('network');
            expect(result.error).toContain('connection reset');
        }
    });
});
