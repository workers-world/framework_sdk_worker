import { describe, expect, it } from 'vitest';
import { isLikelyArticleUrl } from '../../src/url/article-link.js';
import { isLikelyProductLandingUrl } from '../../src/url/product-landing-link.js';

describe('isLikelyArticleUrl', () => {
    it('detects aeon essays path', () => {
        const url = 'https://aeon.co/essays/humans-did-not-invent-art-it-was-the-other-way-around';
        expect(isLikelyProductLandingUrl(url)).toBe(false);
        expect(isLikelyArticleUrl(url)).toBe(true);
    });

    it('detects blog paths', () => {
        expect(isLikelyArticleUrl('https://example.com/blog/my-post')).toBe(true);
        expect(isLikelyArticleUrl('https://example.com/posts/hello-world')).toBe(true);
    });

    it('rejects product landing pages', () => {
        expect(isLikelyArticleUrl('https://pixydesignapp.com/')).toBe(false);
        expect(isLikelyProductLandingUrl('https://pixydesignapp.com/')).toBe(true);
    });

    it('rejects short generic paths', () => {
        expect(isLikelyArticleUrl('https://example.com/about')).toBe(false);
    });

    it('rejects finance yahoo article paths', () => {
        expect(isLikelyArticleUrl('https://finance.yahoo.com/article/pepsico.html')).toBe(false);
    });

    it('detects USGS earthquake eventpage paths', () => {
        expect(
            isLikelyArticleUrl(
                'https://earthquake.usgs.gov/earthquakes/eventpage/us6000tkt2/executive',
            ),
        ).toBe(true);
    });
});
