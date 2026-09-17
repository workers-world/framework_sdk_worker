import { describe, expect, it, vi } from 'vitest';
import {
    assertEnvAsync,
    assertEnvOnce,
    EnvValidationError,
    getEnvMode,
    logResendDryRun,
    shouldResendDryRun,
} from '../../src/env/validate.js';

describe('getEnvMode', () => {
    it('defaults to dev', () => {
        expect(getEnvMode({})).toBe('dev');
    });

    it('detects production', () => {
        expect(getEnvMode({ ENVIRONMENT: 'production' })).toBe('prod');
        expect(getEnvMode({ ENV: 'prod' })).toBe('prod');
        expect(getEnvMode({ ENVIRONMENT: ' Production ' })).toBe('prod');
        expect(getEnvMode({ ENVIRONMENT: 'staging' })).toBe('dev');
        expect(getEnvMode({ ENVIRONMENT: 1 as unknown as string })).toBe('dev');
    });
});

describe('assertEnvAsync', () => {
    it('allows missing prod-only keys in dev', async () => {
        await expect(
            assertEnvAsync({}, [{ key: 'RESEND_API_KEY', required: 'prod' }]),
        ).resolves.toBeUndefined();
    });

    it('throws in prod when required key missing', async () => {
        await expect(
            assertEnvAsync({ ENVIRONMENT: 'production' }, [
                { key: 'RESEND_API_KEY', required: 'prod' },
            ]),
        ).rejects.toBeInstanceOf(EnvValidationError);
    });

    it('treats empty string as missing and checks secrets', async () => {
        await expect(
            assertEnvAsync({ TOKEN: '  ' }, [{ key: 'TOKEN', required: true }]),
        ).rejects.toMatchObject({ missing: ['TOKEN'] });
        await expect(
            assertEnvAsync({ TOKEN: 'ok' }, [{ key: 'TOKEN', required: true }]),
        ).resolves.toBeUndefined();
        await expect(assertEnvAsync({}, [{ key: 'OPTIONAL' }])).resolves.toBeUndefined();
        await expect(
            assertEnvAsync({ SEC: { get: async () => 's' } }, [
                { key: 'SEC', required: true, secret: true },
            ]),
        ).resolves.toBeUndefined();
        await expect(
            assertEnvAsync({}, [{ key: 'SEC', required: true, secret: true }]),
        ).rejects.toBeInstanceOf(EnvValidationError);
    });
});

describe('assertEnvOnce / logResendDryRun', () => {
    it('validates once per signature', async () => {
        const rules = [{ key: 'ONCE_KEY', required: true as const }];
        await expect(
            assertEnvOnce({ ONCE_KEY: 'v' }, rules, { mode: 'dev' }),
        ).resolves.toBeUndefined();
        await expect(assertEnvOnce({}, rules, { mode: 'dev' })).resolves.toBeUndefined();
    });

    it('logs dry-run payload', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        logResendDryRun({ to: 'a@x.com' });
        expect(String(log.mock.calls[0]?.[0])).toContain('notify dryRun');
        log.mockRestore();
    });
});

describe('shouldResendDryRun', () => {
    it('true in dev without api key', () => {
        expect(shouldResendDryRun({}, undefined)).toBe(true);
    });

    it('false when api key present', () => {
        expect(shouldResendDryRun({}, 're_xxx')).toBe(false);
    });

    it('false in prod without key', () => {
        expect(shouldResendDryRun({ ENVIRONMENT: 'production' }, undefined)).toBe(false);
    });
});
