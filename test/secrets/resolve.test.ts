import { describe, expect, it, vi } from 'vitest';
import { resolveSecret } from '../../src/secrets/resolve.js';

describe('resolveSecret', () => {
    it('returns string secret', async () => {
        expect(await resolveSecret('  abc  ')).toBe('abc');
    });

    it('returns undefined for empty string', async () => {
        expect(await resolveSecret('')).toBeUndefined();
    });

    it('resolves Secrets Store binding', async () => {
        const binding = { get: async () => 'from-store' };
        expect(await resolveSecret(binding)).toBe('from-store');
    });

    it('returns undefined when Secrets Store get throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const binding = {
            get: async () => {
                throw new Error('Secrets Worker: Failed to fetch secret');
            },
        };
        expect(await resolveSecret(binding)).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('covers null empty store and unknown shapes', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await resolveSecret(null)).toBeUndefined();
        expect(await resolveSecret(undefined)).toBeUndefined();
        expect(await resolveSecret('   ')).toBeUndefined();
        expect(await resolveSecret({ get: async () => 12 as unknown as string })).toBeUndefined();
        expect(
            await resolveSecret({
                get: async () => {
                    throw 'store-down';
                },
            }),
        ).toBeUndefined();
        expect(await resolveSecret({} as { get(): Promise<string> })).toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
