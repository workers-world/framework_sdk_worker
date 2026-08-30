import { describe, expect, it } from 'vitest';
import { requireAdminAuth } from '../../src/auth/require-admin.js';

describe('requireAdminAuth', () => {
    it('returns null when authorized', async () => {
        const req = new Request('https://x/v1/rules', {
            headers: { Authorization: 'Bearer admin-token' },
        });
        await expect(requireAdminAuth(req, 'admin-token')).resolves.toBeNull();
    });

    it('returns 401 Response with ok:false on wrong token', async () => {
        const req = new Request('https://x/v1/rules', {
            headers: { Authorization: 'Bearer bad' },
        });
        const resp = await requireAdminAuth(req, 'admin-token');
        expect(resp?.status).toBe(401);
        await expect(resp?.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' });
    });

    it('returns 503 with configured message when token missing', async () => {
        const req = new Request('https://x/v1/rules');
        const resp = await requireAdminAuth(req, undefined);
        expect(resp?.status).toBe(503);
        await expect(resp?.json()).resolves.toEqual({
            ok: false,
            error: 'RULES_ADMIN_TOKEN not configured',
        });
    });
});
