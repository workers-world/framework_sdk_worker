import { describe, expect, it } from 'vitest';
import { normalizeKvDedupKey } from './dedup.js';

describe('normalizeKvDedupKey', () => {
  it('returns short keys unchanged', async () => {
    const key = 'hn-daily:https://example.com/item';
    await expect(normalizeKvDedupKey(key)).resolves.toBe(key);
  });

  it('hashes keys longer than 400 bytes', async () => {
    const long = `prefix:${'x'.repeat(500)}`;
    const hashed = await normalizeKvDedupKey(long);
    expect(hashed.startsWith('dedup:')).toBe(true);
    expect(hashed.length).toBeLessThan(80);
    await expect(normalizeKvDedupKey(long)).resolves.toBe(hashed);
  });
});
