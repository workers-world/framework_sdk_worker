import { describe, expect, it } from 'vitest';
import { escapeLike } from '../../src/d1/escape-like.js';

describe('escapeLike', () => {
    it('escapes backslash percent underscore', () => {
        expect(escapeLike('100%')).toBe('100\\%');
        expect(escapeLike('a_b')).toBe('a\\_b');
        expect(escapeLike('c\\d')).toBe('c\\\\d');
        expect(escapeLike('normal')).toBe('normal');
    });
});
