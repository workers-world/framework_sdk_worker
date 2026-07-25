import { describe, expect, it } from 'vitest';
import { capInput } from './cap-input.js';

describe('capInput', () => {
  it('returns original when within max', () => {
    expect(capInput('hello', 10)).toBe('hello');
  });

  it('truncates without ellipsis when over max', () => {
    expect(capInput('hello world', 5)).toBe('hello');
  });

  it('returns empty for non-positive max', () => {
    expect(capInput('hello', 0)).toBe('');
    expect(capInput('hello', -1)).toBe('');
  });
});
