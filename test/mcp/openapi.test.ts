import { describe, expect, it, vi } from 'vitest';
import { fetchUpstreamOpenApi, mergeOpenApiDocs } from '../../src/mcp/openapi.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('fetchUpstreamOpenApi', () => {
    it('returns empty paths without fetcher', async () => {
        await expect(fetchUpstreamOpenApi(undefined, 'https://desk')).resolves.toEqual({
            openapi: '3.1.0',
            info: { title: 'https://desk', version: '0' },
            paths: {},
        });
    });

    it('parses JSON on 200', async () => {
        const fetcher = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ openapi: '3.1.0', paths: { '/v1/x': {} } }), {
                    status: 200,
                }),
        );
        const doc = await fetchUpstreamOpenApi(fetcher, 'https://desk');
        expect(doc.paths).toEqual({ '/v1/x': {} });
    });

    it('returns empty paths on HTTP error', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetcher = makeFakeFetcher(() => new Response('no', { status: 503 }));
        const doc = await fetchUpstreamOpenApi(fetcher, 'https://desk');
        expect(doc.paths).toEqual({});
        expect(warn.mock.calls[0]?.[0]).toContain('HTTP 503');
        warn.mockRestore();
    });

    it('returns empty paths on fetch throw', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetcher = makeFakeFetcher(() => {
            throw new Error('network');
        });
        const doc = await fetchUpstreamOpenApi(fetcher, 'https://desk');
        expect(doc.paths).toEqual({});
        expect(warn.mock.calls[0]?.[0]).toContain('network');

        const fetcher2 = makeFakeFetcher(() => {
            throw 'raw';
        });
        await fetchUpstreamOpenApi(fetcher2, 'https://desk');
        warn.mockRestore();
    });
});

describe('mergeOpenApiDocs', () => {
    it('merges paths and components; later docs win on conflict', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const merged = mergeOpenApiDocs([
            {
                name: 'a',
                doc: {
                    paths: { '/v1/x': { get: { summary: 'a' } } },
                    components: { schemas: { A: {} } },
                },
            },
            {
                name: 'b',
                doc: {
                    paths: { '/v1/x': { get: { summary: 'b' } }, '/v1/y': {} },
                    components: { schemas: { B: {} } },
                },
            },
            { name: 'c', doc: {} },
        ]);
        expect(merged.paths?.['/v1/x']).toEqual({ get: { summary: 'b' } });
        expect(merged.paths?.['/v1/y']).toEqual({});
        expect(merged.components).toEqual({ schemas: { B: {} } });
        expect(warn.mock.calls[0]?.[0]).toContain('openapi path 冲突');
        expect(merged.info?.title).toBe('merged');
        warn.mockRestore();
    });
});
