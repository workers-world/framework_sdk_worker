import { describe, expect, it, vi } from 'vitest';
import {
    classifyPageMetaForFetch,
    resolveLandingOrArticleFetch,
} from '../../src/http/fetch-page-meta.js';
import { createFetchImplWithDns } from './dns-fetch-mock.js';

describe('classifyPageMetaForFetch', () => {
    it('classifies SaaS marketing meta as landing', () => {
        expect(
            classifyPageMetaForFetch({
                source: 'og',
                title: 'Pixy',
                description: 'Start your free trial — visual editor for coding agents.',
            }),
        ).toBe('landing');
    });

    it('classifies creative promotion meta as landing', () => {
        expect(
            classifyPageMetaForFetch({
                source: 'og',
                title: 'Impulse Tracker',
                description: 'Impulse Tracker, short story written by Ovi Demetrian Jr.',
            }),
        ).toBe('landing');
    });

    it('classifies essay/article meta as article', () => {
        expect(
            classifyPageMetaForFetch({
                source: 'og',
                title: 'AI Chip Architectures and the Future of Inference',
                description:
                    'This essay explores how chip design shapes model deployment. It covers memory bandwidth, interconnects, and power envelopes. Published on March 2024.',
            }),
        ).toBe('article');
    });

    it('returns unknown when meta is empty', () => {
        expect(classifyPageMetaForFetch({ source: 'none' })).toBe('unknown');
    });
});

const TRIAL_LANDING_HTML = `<!DOCTYPE html><html><head>
  <meta property="og:title" content="Acme App" />
  <meta property="og:description" content="Start your free trial today. No credit card required." />
</head><body><h1>Acme</h1></body></html>`;

const ESSAY_HTML = `<!DOCTYPE html><html><head>
  <meta property="og:title" content="AI Chip Architectures and the Future of Inference" />
  <meta property="og:description" content="This essay explores how chip design shapes model deployment. It covers memory bandwidth, interconnects, and power envelopes. Published on March 2024." />
</head><body><article><p>Body</p></article></body></html>`;

describe('resolveLandingOrArticleFetch', () => {
    it('routes confident landing URLs directly to landing path', async () => {
        const fetchImpl = createFetchImplWithDns(
            new Response(TRIAL_LANDING_HTML, {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        );
        const result = await resolveLandingOrArticleFetch('https://example.com/pricing', {
            fetchImpl,
        });
        expect(result.path).toBe('landing');
        expect(result.snippet).toContain('产品落地页元信息');
    });

    it('routes ambiguous marketing slug to landing after meta probe', async () => {
        const fetchImpl = createFetchImplWithDns(
            new Response(TRIAL_LANDING_HTML, {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        );
        const result = await resolveLandingOrArticleFetch(
            'https://example.com/start-your-free-trial-now',
            { fetchImpl },
        );
        expect(result.path).toBe('landing');
        expect(result.snippet).toContain('free trial');
    });

    it('routes ambiguous essay slug to article after meta probe', async () => {
        const fetchImpl = createFetchImplWithDns(
            new Response(ESSAY_HTML, {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        );
        const result = await resolveLandingOrArticleFetch(
            'https://www.jepeake.com/ai-chip-architectures',
            { fetchImpl },
        );
        expect(result.path).toBe('article');
    });

    it('skips meta fetch for blog paths', async () => {
        const fetchImpl = vi.fn();
        const result = await resolveLandingOrArticleFetch('https://example.com/blog/post', {
            fetchImpl,
        });
        expect(result.path).toBe('article');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
