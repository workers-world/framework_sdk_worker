import { describe, expect, it } from 'vitest';
import { jsonError, jsonResponse } from '../../src/http/errors.js';

describe('jsonError', () => {
    it('defaults to 400 with error payload', async () => {
        const resp = jsonError('bad request');
        expect(resp.status).toBe(400);
        expect(resp.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        await expect(resp.json()).resolves.toEqual({ error: 'bad request' });
    });

    it('accepts custom status', async () => {
        const resp = jsonError('nope', 403);
        expect(resp.status).toBe(403);
        await expect(resp.json()).resolves.toEqual({ error: 'nope' });
    });
});

describe('jsonResponse', () => {
    it('defaults to 200', async () => {
        const resp = jsonResponse({ ok: true });
        expect(resp.status).toBe(200);
        expect(resp.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        await expect(resp.json()).resolves.toEqual({ ok: true });
    });

    it('accepts custom status and serializes nested body', async () => {
        const resp = jsonResponse({ items: [1, 2] }, 201);
        expect(resp.status).toBe(201);
        await expect(resp.json()).resolves.toEqual({ items: [1, 2] });
    });
});
