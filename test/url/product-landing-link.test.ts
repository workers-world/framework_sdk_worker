import { describe, expect, it } from 'vitest';
import {
    classifyLinkLandingTier,
    describeProductLandingLink,
    isLikelyProductLandingUrl,
    needsMetaProbeForLanding,
} from '../../src/url/product-landing-link.js';

describe('classifyLinkLandingTier', () => {
    it('marks root and index as landing', () => {
        expect(classifyLinkLandingTier('https://pixydesignapp.com/')).toBe('landing');
        expect(classifyLinkLandingTier('https://www.pixydesignapp.com/index.html')).toBe('landing');
    });

    it('marks simple single-segment slugs as landing', () => {
        expect(classifyLinkLandingTier('https://example.com/pricing')).toBe('landing');
        expect(classifyLinkLandingTier('https://example.com/app')).toBe('landing');
        expect(classifyLinkLandingTier('https://example.com/sign-up')).toBe('landing');
    });

    it('marks multi-hyphen single-segment slugs as ambiguous', () => {
        expect(classifyLinkLandingTier('https://example.com/get-started-now')).toBe('ambiguous');
        expect(classifyLinkLandingTier('https://example.com/start-your-free-trial-now')).toBe(
            'ambiguous',
        );
        expect(classifyLinkLandingTier('https://surya.website/rling-qwen-to-paint-with-code')).toBe(
            'ambiguous',
        );
        expect(classifyLinkLandingTier('https://www.jepeake.com/ai-chip-architectures')).toBe(
            'ambiguous',
        );
    });

    it('marks article paths and hosts as not_landing', () => {
        expect(classifyLinkLandingTier('https://example.com/blog/my-post')).toBe('not_landing');
        expect(classifyLinkLandingTier('https://medium.com/@user/story')).toBe('not_landing');
        expect(classifyLinkLandingTier('https://example.com/2024/01/hello')).toBe('not_landing');
    });
});

describe('isLikelyProductLandingUrl', () => {
    it('is true only for Tier 0 landing', () => {
        expect(isLikelyProductLandingUrl('https://pixydesignapp.com/')).toBe(true);
        expect(isLikelyProductLandingUrl('https://example.com/pricing')).toBe(true);
        expect(isLikelyProductLandingUrl('https://example.com/sign-up')).toBe(true);
    });

    it('is false for ambiguous slugs (handled by meta probe)', () => {
        expect(isLikelyProductLandingUrl('https://example.com/get-started-now')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/start-your-free-trial-now')).toBe(
            false,
        );
        expect(
            isLikelyProductLandingUrl('https://surya.website/rling-qwen-to-paint-with-code'),
        ).toBe(false);
    });

    it('rejects article-like paths', () => {
        expect(isLikelyProductLandingUrl('https://example.com/blog/my-post')).toBe(false);
        expect(isLikelyProductLandingUrl('https://example.com/posts/hello')).toBe(false);
        expect(isLikelyProductLandingUrl('https://github.com/org/repo')).toBe(false);
    });

    it('rejects empty or invalid', () => {
        expect(isLikelyProductLandingUrl('')).toBe(false);
        expect(isLikelyProductLandingUrl('not-a-url')).toBe(false);
        expect(isLikelyProductLandingUrl('ftp://example.com/')).toBe(false);
    });
});

describe('needsMetaProbeForLanding', () => {
    it('matches ambiguous tier only', () => {
        expect(needsMetaProbeForLanding('https://example.com/start-your-free-trial')).toBe(true);
        expect(needsMetaProbeForLanding('https://example.com/pricing')).toBe(false);
        expect(needsMetaProbeForLanding('https://example.com/blog/x')).toBe(false);
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
