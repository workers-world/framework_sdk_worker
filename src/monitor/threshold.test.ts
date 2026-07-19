import { describe, expect, it } from 'vitest';
import { buildDedupKey, computeNotifyTier, withinAlertBand } from './threshold.js';

describe('withinAlertBand', () => {
  describe('buy', () => {
    it('returns true when diffPct is below threshold', () => {
      expect(withinAlertBand('buy', -0.05, 0.02)).toBe(true);
    });

    it('returns true when diffPct equals threshold', () => {
      expect(withinAlertBand('buy', 0.02, 0.02)).toBe(true);
    });

    it('returns false when diffPct is above threshold', () => {
      expect(withinAlertBand('buy', 0.03, 0.02)).toBe(false);
    });

    it('returns true at zero diff', () => {
      expect(withinAlertBand('buy', 0, 0.02)).toBe(true);
    });
  });

  describe('sell', () => {
    it('returns true when diffPct is within band above trigger', () => {
      expect(withinAlertBand('sell', -0.01, 0.02)).toBe(true);
    });

    it('returns true when diffPct equals negative threshold', () => {
      expect(withinAlertBand('sell', -0.02, 0.02)).toBe(true);
    });

    it('returns false when diffPct is below negative threshold', () => {
      expect(withinAlertBand('sell', -0.03, 0.02)).toBe(false);
    });

    it('returns true for positive diff (already past target)', () => {
      expect(withinAlertBand('sell', 0.05, 0.02)).toBe(true);
    });
  });
});

describe('computeNotifyTier', () => {
  describe('buy', () => {
    it('returns 0 when price is above target', () => {
      expect(computeNotifyTier('buy', 0.01, 0.005)).toBe(0);
    });

    it('returns tier 1 at first step below target', () => {
      expect(computeNotifyTier('buy', -0.004, 0.005)).toBe(1);
    });

    it('returns tier 2 when two steps below target', () => {
      expect(computeNotifyTier('buy', -0.01, 0.005)).toBe(2);
    });

    it('returns 0 at exactly zero diff', () => {
      expect(computeNotifyTier('buy', 0, 0.005)).toBe(0);
    });

    it('ceil rounds partial steps up', () => {
      expect(computeNotifyTier('buy', -0.006, 0.005)).toBe(2);
    });
  });

  describe('sell', () => {
    it('returns 0 when diffPct is negative (below target)', () => {
      expect(computeNotifyTier('sell', -0.01, 0.005)).toBe(0);
    });

    it('returns tier 1 at first step above target', () => {
      expect(computeNotifyTier('sell', 0.004, 0.005)).toBe(1);
    });

    it('returns tier 2 when two steps above target', () => {
      expect(computeNotifyTier('sell', 0.01, 0.005)).toBe(2);
    });

    it('returns 0 at exactly zero diff', () => {
      expect(computeNotifyTier('sell', 0, 0.005)).toBe(0);
    });

    it('ceil rounds partial steps up', () => {
      expect(computeNotifyTier('sell', 0.006, 0.005)).toBe(2);
    });
  });
});

describe('buildDedupKey', () => {
  it('builds key with prefix, scope, date, and tier', () => {
    expect(buildDedupKey('fund-alert', '110022', '2026-07-19', 2)).toBe(
      'fund-alert:110022:2026-07-19:t2',
    );
  });

  it('supports tier 0', () => {
    expect(buildDedupKey('gold', 'AU9999', '2026-07-19', 0)).toBe(
      'gold:AU9999:2026-07-19:t0',
    );
  });

  it('keeps scope strings opaque', () => {
    expect(buildDedupKey('x', 'scope:with:colons', '2026-01-01', 1)).toBe(
      'x:scope:with:colons:2026-01-01:t1',
    );
  });
});
