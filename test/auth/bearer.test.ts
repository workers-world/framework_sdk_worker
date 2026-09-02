import { describe, expect, it } from 'vitest';
import { authorizeRequest, checkBearerToken } from '../../src/auth/bearer.js';

const TOKEN = ['unit', 'test', 'bearer', 'fixture'].join('-');

describe('checkBearerToken', () => {
    it('accepts a valid Bearer token', () => {
        expect(checkBearerToken(`Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true });
    });

    it('rejects a wrong token with 401', () => {
        expect(checkBearerToken('Bearer wrong', TOKEN)).toEqual({
            ok: false,
            status: 401,
            error: 'Unauthorized',
        });
    });

    it('rejects missing/blank Authorization header', () => {
        for (const header of [null, undefined, '']) {
            expect(checkBearerToken(header, TOKEN)).toEqual({
                ok: false,
                status: 401,
                error: 'Unauthorized',
            });
        }
    });

    it('rejects non-Bearer scheme and prefix-only match', () => {
        expect(checkBearerToken(`Basic ${TOKEN}`, TOKEN).ok).toBe(false);
        expect(checkBearerToken(`Bearer ${TOKEN.slice(0, 6)}`, TOKEN).ok).toBe(false);
        expect(checkBearerToken(`Bearer ${TOKEN} `, TOKEN).ok).toBe(false);
        expect(checkBearerToken(`bearer ${TOKEN}`, TOKEN).ok).toBe(false);
    });

    it('rejects when expected token not configured (default 401)', () => {
        expect(checkBearerToken(`Bearer ${TOKEN}`, undefined)).toEqual({
            ok: false,
            status: 401,
            error: 'Unauthorized',
        });
    });

    it('returns 503 with custom message when requireConfigured and missing', () => {
        expect(
            checkBearerToken(`Bearer ${TOKEN}`, undefined, {
                requireConfigured: true,
                missingConfigMessage: 'RULES_ADMIN_TOKEN not configured',
            }),
        ).toEqual({
            ok: false,
            status: 503,
            error: 'RULES_ADMIN_TOKEN not configured',
        });
    });
});

describe('authorizeRequest', () => {
    it('mirrors checkBearerToken for Request headers', () => {
        expect(
            authorizeRequest(
                new Request('https://x/', { headers: { Authorization: `Bearer ${TOKEN}` } }),
                TOKEN,
            ),
        ).toBe(true);
        expect(authorizeRequest(new Request('https://x/'), TOKEN)).toBe(false);
    });
});
