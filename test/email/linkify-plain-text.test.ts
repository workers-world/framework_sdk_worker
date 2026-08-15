import { describe, expect, it } from 'vitest';
import { linkifyPlainTextEmail } from '../../src/email/linkify-plain-text.js';

describe('linkifyPlainTextEmail', () => {
    it('wraps http(s) URLs in anchors', () => {
        const html = linkifyPlainTextEmail('see https://example.com/path?q=1');
        expect(html).toContain(
            '<a href="https://example.com/path?q=1">https://example.com/path?q=1</a>',
        );
        expect(html).toContain('white-space:pre-wrap');
    });

    it('linkifies Label: URL lines', () => {
        const html = linkifyPlainTextEmail(
            'URL: https://github.com/org/repo/pull/2\nActions: https://github.com/org/repo/actions/runs/1',
        );
        expect(html).toContain(
            'URL: <a href="https://github.com/org/repo/pull/2">https://github.com/org/repo/pull/2</a>',
        );
        expect(html).toContain(
            'Actions: <a href="https://github.com/org/repo/actions/runs/1">https://github.com/org/repo/actions/runs/1</a>',
        );
    });

    it('escapes HTML before linkifying', () => {
        const html = linkifyPlainTextEmail('<script>x</script> https://ok.example');
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('<a href="https://ok.example">https://ok.example</a>');
    });

    it('returns escaped text in container when no URL', () => {
        const html = linkifyPlainTextEmail('hello & world');
        expect(html).toBe(
            '<div style="font-family:system-ui,sans-serif;white-space:pre-wrap">hello &amp; world</div>',
        );
    });

    it('strips trailing punctuation from URL match', () => {
        const html = linkifyPlainTextEmail('go https://example.com.');
        expect(html).toContain('<a href="https://example.com">https://example.com</a>.');
    });

    it('handles empty string', () => {
        expect(linkifyPlainTextEmail('')).toBe(
            '<div style="font-family:system-ui,sans-serif;white-space:pre-wrap"></div>',
        );
    });
});
