import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/email/escape-html.js';

describe('escapeHtml', () => {
    it('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe(
            '&lt;script&gt;alert(1)&lt;/script&gt;',
        );
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('escapes all special characters together', () => {
        expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    });

    it('returns plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });
});
