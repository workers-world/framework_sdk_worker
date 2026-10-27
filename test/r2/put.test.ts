import { describe, expect, it } from 'vitest';
import { putBinary, putJson } from '../../src/r2/put.js';

function makeBucket() {
    const puts: Array<{
        key: string;
        data: unknown;
        options: {
            httpMetadata?: { contentType?: string };
            customMetadata?: Record<string, string>;
        };
    }> = [];
    const bucket = {
        put: async (key: string, data: unknown, options: (typeof puts)[number]['options']) => {
            puts.push({ key, data, options });
            return { key };
        },
    } as unknown as R2Bucket;
    return { bucket, puts };
}

describe('putBinary', () => {
    it('writes content type and custom metadata then returns key', async () => {
        const { bucket, puts } = makeBucket();
        const key = await putBinary(bucket, 'a.bin', 'bytes', {
            contentType: 'application/octet-stream',
            customMetadata: { k: 'v' },
        });
        expect(key).toBe('a.bin');
        expect(puts[0]?.options.httpMetadata?.contentType).toBe('application/octet-stream');
        expect(puts[0]?.options.customMetadata).toEqual({ k: 'v' });
        expect(puts[0]?.data).toBe('bytes');
    });
});

describe('putJson', () => {
    it('stringifies body as application/json', async () => {
        const { bucket, puts } = makeBucket();
        const key = await putJson(bucket, 'a.json', { n: 1 }, { src: 'test' });
        expect(key).toBe('a.json');
        expect(puts[0]?.data).toBe(JSON.stringify({ n: 1 }));
        expect(puts[0]?.options.httpMetadata?.contentType).toBe('application/json');
        expect(puts[0]?.options.customMetadata).toEqual({ src: 'test' });
    });

    it('omits custom metadata when not provided', async () => {
        const { bucket, puts } = makeBucket();
        await putJson(bucket, 'b.json', []);
        expect(puts[0]?.options.customMetadata).toBeUndefined();
    });
});
