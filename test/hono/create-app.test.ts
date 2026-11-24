import { describe, expect, it, vi } from 'vitest';
import {
    createWorkerApp,
    registerGlobalErrorHandler,
    registerHealthRoute,
    registerNotFoundRoute,
    registerOpenApiRoute,
} from '../../src/hono/create-app.js';

describe('createWorkerApp', () => {
    it('creates a Hono app without CORS by default', async () => {
        const app = createWorkerApp();
        registerHealthRoute(app);
        const resp = await app.request('/health');
        expect(resp.status).toBe(200);
        await expect(resp.json()).resolves.toEqual({ ok: true });
        expect(resp.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('enables CORS when requested', async () => {
        const app = createWorkerApp({ cors: true });
        registerHealthRoute(app);
        const resp = await app.request('/health', { headers: { Origin: 'https://example.com' } });
        expect(resp.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });
});

describe('registerOpenApiRoute', () => {
    it('serves the given doc at /openapi.json', async () => {
        const app = createWorkerApp();
        registerOpenApiRoute(app, {
            openapi: '3.1.0',
            info: { title: 'demo', version: '0.1.0' },
            paths: { '/v1/demo': { get: { operationId: 'demo' } } },
        });
        const resp = await app.request('/openapi.json');
        expect(resp.status).toBe(200);
        await expect(resp.json()).resolves.toMatchObject({ info: { title: 'demo' } });
        expect(resp.headers.get('Content-Type')).toContain('application/json');
    });

    it('accepts a doc with extra fields (index signature)', async () => {
        const app = createWorkerApp();
        registerOpenApiRoute(app, { info: { title: 'x' }, 'x-internal': true });
        const resp = await app.request('/openapi.json');
        await expect(resp.json()).resolves.toEqual({ info: { title: 'x' }, 'x-internal': true });
    });
});

describe('registerNotFoundRoute / registerGlobalErrorHandler', () => {
    it('returns 404 JSON for unmatched GET', async () => {
        const app = createWorkerApp();
        registerNotFoundRoute(app);
        const resp = await app.request('/no-such');
        expect(resp.status).toBe(404);
        await expect(resp.json()).resolves.toEqual({ error: 'Not Found' });
    });

    it('maps thrown errors to 500 JSON and logs', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const app = createWorkerApp();
        registerGlobalErrorHandler(app, '内部错误', 'INTERNAL_ERROR');
        app.get('/boom', () => {
            throw new Error('explode');
        });
        const resp = await app.request('/boom');
        expect(resp.status).toBe(500);
        await expect(resp.json()).resolves.toEqual({ error: '内部错误', code: 'INTERNAL_ERROR' });
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('uses default message and code', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const app = createWorkerApp();
        registerGlobalErrorHandler(app);
        app.get('/boom', () => {
            throw new Error('x');
        });
        const resp = await app.request('/boom');
        await expect(resp.json()).resolves.toEqual({ error: '内部错误', code: 'INTERNAL_ERROR' });
        vi.restoreAllMocks();
    });
});
