import { describe, expect, it } from 'vitest';
import { isAdminAuthSkipped, isAdminAuthSkippedFromEnv } from '../../src/auth/admin-auth-skip.js';

describe('isAdminAuthSkipped', () => {
    it('true for skipFlag 1|true|yes', () => {
        expect(isAdminAuthSkipped({ skipFlag: '1' })).toBe(true);
        expect(isAdminAuthSkipped({ skipFlag: 'true', environment: 'production' })).toBe(true);
        expect(isAdminAuthSkipped({ skipFlag: 'YES' })).toBe(true);
    });

    it('true for ENVIRONMENT=development', () => {
        expect(isAdminAuthSkipped({ environment: 'development' })).toBe(true);
        expect(isAdminAuthSkipped({ environment: 'Development' })).toBe(true);
    });

    it('false for production without flag', () => {
        expect(isAdminAuthSkipped({ environment: 'production' })).toBe(false);
        expect(isAdminAuthSkipped({})).toBe(false);
    });
});

describe('isAdminAuthSkippedFromEnv', () => {
    it('reads ENVIRONMENT and skipFlagEnvKey', () => {
        expect(
            isAdminAuthSkippedFromEnv(
                { ENVIRONMENT: 'production', X_SKIP: '1' },
                { skipFlagEnvKey: 'X_SKIP' },
            ),
        ).toBe(true);
        expect(isAdminAuthSkippedFromEnv({ ENVIRONMENT: 'development' })).toBe(true);
    });
});
