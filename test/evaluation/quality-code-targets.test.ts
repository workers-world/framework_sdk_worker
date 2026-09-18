import { describe, expect, it } from 'vitest';
import {
    githubBlobUrl,
    inferSuspectedLayerFromIncident,
    type QualityCodeAnchorsRegistry,
    resolveCodeAnchorPaths,
    resolveWorkerRepoUrl,
} from '../../src/evaluation/quality-code-targets.js';

const REGISTRY: QualityCodeAnchorsRegistry = {
    services: {
        'email-rule-worker': {
            github: { owner: 'workers-world', repo: 'email-rule-worker' },
            layers: {
                summarize: ['src/services/summarize.ts'],
                fetch: ['src/services/fetch-article-browser.ts'],
            },
        },
    },
};

describe('quality-code-targets', () => {
    it('resolveWorkerRepoUrl 返回 GitHub URL', () => {
        expect(resolveWorkerRepoUrl('email-rule-worker', REGISTRY)).toBe(
            'https://github.com/workers-world/email-rule-worker',
        );
    });

    it('resolveCodeAnchorPaths 按 layer 返回路径', () => {
        expect(resolveCodeAnchorPaths('email-rule-worker', 'summarize', REGISTRY)).toEqual([
            'src/services/summarize.ts',
        ]);
    });

    it('inferSuspectedLayerFromIncident 从 chain 推断', () => {
        expect(inferSuspectedLayerFromIncident({ chain: 'fetch→browser:ok' })).toBe('fetch');
        expect(inferSuspectedLayerFromIncident({ path: 'title_only', chain: 'summarize' })).toBe(
            'summarize',
        );
        expect(
            inferSuspectedLayerFromIncident({ path: 'title_only', chain: 'fetch→browser:ok' }),
        ).toBe('summarize');
        expect(inferSuspectedLayerFromIncident({ chain: 'llm-gateway:timeout' })).toBe('llm');
        expect(inferSuspectedLayerFromIncident({ chain: 'notify:send' })).toBe('notify');
        expect(inferSuspectedLayerFromIncident({ chain: 'product_landing' })).toBe('url_heuristic');
        expect(inferSuspectedLayerFromIncident({ path: 'fetch-article' })).toBe('fetch');
        expect(inferSuspectedLayerFromIncident({ chain: 'summarize:done' })).toBe('summarize');
        expect(inferSuspectedLayerFromIncident({})).toBe('unknown');
    });

    it('resolveWorkerRepoUrl / resolveCodeAnchorPaths handle missing service and unknown layer', () => {
        expect(resolveWorkerRepoUrl('missing', REGISTRY)).toBeUndefined();
        expect(resolveCodeAnchorPaths('missing', 'fetch', REGISTRY)).toEqual([]);
        expect(resolveCodeAnchorPaths('email-rule-worker', 'unknown', REGISTRY)).toEqual([]);
        expect(githubBlobUrl('https://github.com/o/r/', '/src/a.ts')).toBe(
            'https://github.com/o/r/blob/master/src/a.ts',
        );
        expect(githubBlobUrl('https://github.com/o/r', 'src/a.ts', 'dev')).toBe(
            'https://github.com/o/r/blob/dev/src/a.ts',
        );
    });
});
