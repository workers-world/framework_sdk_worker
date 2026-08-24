import { describe, expect, it } from 'vitest';
import {
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
        expect(inferSuspectedLayerFromIncident({ chain: 'llm-gateway:timeout' })).toBe('llm');
    });
});
