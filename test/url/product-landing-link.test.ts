import { describe, expect, it } from 'vitest';
import {
    describeProductLandingLink,
    isLikelyProductLandingUrl,
} from '../../src/url/product-landing-link.js';

describe('isLikelyProductLandingUrl', () => {
    it('detects root and index paths', () => {
        expect(isLikelyProductLandingUrl('https://pixydesignapp.com/')).toBe(true);
        expect(isLikelyProductLandingUrl('https://pixydesignapp.com')).toBe(true);
        expect(isLikelyProductLandingUrl('https://www.pixydesignapp.com/index.html')).toBe(true);
    });

    it('detects single short marketing slug', () => {
        expect(isLikelyProductLandingUrl('https://example.com/pricing')).toBe(true);
        expect(isLikelyProductLandingUrl('https://example.com/app')).toBe(true);
    });

    it('rejects article-like paths', () => {
        expect(isLikelyProductLandingUrl('https://example.com/blog/my-post')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/posts/hello')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/article/foo')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/2024/01/hello')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/p/abc123')).toBe(false);
    });

    it('rejects known article hosts', () => {
        expect(isLikelyProductLandingUrl('https://medium.com/@user/story')).toBe(false);
        expect(isLikelyProductLandingUrl('https://foo.substack.com/')).toBe(false);
        expect(isLikelyProductLandingUrl('https://github.com/org/repo')).toBe(false);
        expect(isLikelyProductLandingUrl('https://news.ycombinator.com/item?id=1')).toBe(false);
        expect(isLikelyProductLandingUrl('https://finance.yahoo.com/')).toBe(false);
    });

    it('rejects empty or invalid', () => {
        expect(isLikelyProductLandingUrl('')).toBe(false);
        expect(isLikelyProductLandingUrl('not-a-url')).toBe(false);
        expect(isLikelyProductLandingUrl('ftp://example.com/')).toBe(false);
    });
});

describe('describeProductLandingLink', () => {
    it('includes hostname', () => {
        expect(describeProductLandingLink('https://www.pixydesignapp.com/')).toContain(
            'pixydesignapp.com',
        );
        expect(describeProductLandingLink('https://www.pixydesignapp.com/')).toContain(
            '产品落地页',
        );
    });
});
