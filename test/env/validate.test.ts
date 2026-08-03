import { describe, expect, it } from 'vitest';
import { assertEnvAsync, EnvValidationError, getEnvMode, shouldResendDryRun } from '../../src/env/validate.js';

describe('getEnvMode', () => {
    it('defaults to dev', () => {
        expect(getEnvMode({})).toBe('dev');
    });

    it('detects production', () => {
        expect(getEnvMode({ ENVIRONMENT: 'production' })).toBe('prod');
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
