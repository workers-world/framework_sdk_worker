import { describe, expect, it } from 'vitest';
import { pad2, shanghaiYmd, shanghaiMinuteBucket } from './shanghai.js';

describe('shanghai time', () => {
  it('pad2 zero-pads single digits', () => {
    expect(pad2(5)).toBe('05');
    expect(pad2(12)).toBe('12');
  });

  it('shanghaiYmd returns YYYYMMDD', () => {
    const result = shanghaiYmd(new Date('2026-01-15T10:00:00Z'));
    expect(result).toMatch(/^\d{8}$/);
  });

  it('shanghaiMinuteBucket returns YYYYMMDDHHmm', () => {
    const result = shanghaiMinuteBucket(new Date('2026-01-15T10:00:00Z'));
    expect(result).toMatch(/^\d{12}$/);
  });
});
