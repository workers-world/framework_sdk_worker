import { describe, expect, it } from 'vitest';
import {
  pad2,
  secondsUntilNextShanghaiDay,
  shanghaiIsoString,
  shanghaiMinuteBucket,
  shanghaiYmPath,
  shanghaiYmd,
  shanghaiYmdDash,
} from './shanghai.js';

describe('shanghai time', () => {
  const sample = new Date('2026-01-15T10:00:00Z');

  it('pad2 zero-pads single digits', () => {
    expect(pad2(5)).toBe('05');
    expect(pad2(12)).toBe('12');
  });

  it('shanghaiYmd returns YYYYMMDD', () => {
    expect(shanghaiYmd(sample)).toBe('20260115');
  });

  it('shanghaiYmdDash returns YYYY-MM-DD', () => {
    expect(shanghaiYmdDash(sample)).toBe('2026-01-15');
  });

  it('shanghaiIsoString returns +08:00 offset', () => {
    expect(shanghaiIsoString(sample)).toBe('2026-01-15T18:00:00+08:00');
  });

  it('shanghaiYmPath returns YYYY/MM', () => {
    expect(shanghaiYmPath(sample)).toBe('2026/01');
  });

  it('shanghaiMinuteBucket returns YYYYMMDDHHmm', () => {
    expect(shanghaiMinuteBucket(sample)).toBe('202601151800');
  });

  it('secondsUntilNextShanghaiDay returns positive seconds', () => {
    expect(secondsUntilNextShanghaiDay(sample)).toBeGreaterThan(0);
  });
});
