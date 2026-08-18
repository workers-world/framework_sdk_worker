import { describe, expect, it } from 'vitest';
import { resolveSecret } from '../../src/secrets/resolve.js';

describe('resolveSecret', () => {
    it('returns trimmed string secrets', async () => {
        expect(await resolveSecret('  abc  ')).toBe('abc');
        expect(await resolveSecret('')).toBeUndefined();
        expect(await resolveSecret(undefined)).toBeUndefined();
    });

    it('awaits Secrets Store binding get()', async () => {
        expect(await resolveSecret({ get: async () => 'store-token' })).toBe('store-token');
        expect(await resolveSecret({ get: async () => '  ' })).toBeUndefined();
    });
});
