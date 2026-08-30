import { describe, expect, it } from 'vitest';
import {
    type ContentFilterConfig,
    contentFilterKvKey,
    defaultActionForStage,
    dispatchContentFilterAction,
    emptyContentFilterConfig,
    evaluateContentFilter,
    normalizeActionForStage,
    shouldContinuePipeline,
    shouldStopPipeline,
    validateContentFilterConfig,
} from '../../src/evaluation/content-filter.js';

const sampleConfig: ContentFilterConfig = {
    version: 1,
    rules: [
        {
            id: 'spam-gpu',
            enabled: true,
            stage: 'before',
            action: 'block',
            match: {
                type: 'keyword',
                fields: ['title', 'snippet'],
                values: ['新款显卡', '限时优惠'],
            },
        },
        {
            id: 'post-marketing',
            enabled: true,
            stage: 'after',
            action: 'block_notify',
            match: {
                type: 'regex',
                fields: ['title', 'llmSummary'],
                pattern: '广告|推广',
            },
        },
        {
            id: 'disabled-rule',
            enabled: false,
            stage: 'before',
            match: { type: 'keyword', fields: ['title'], values: ['ignore-me'] },
        },
    ],
};

describe('defaultActionForStage', () => {
    it('returns block for before and block_notify for after', () => {
        expect(defaultActionForStage('before')).toBe('block');
        expect(defaultActionForStage('after')).toBe('block_notify');
    });
});

describe('normalizeActionForStage', () => {
    it('defaults when action omitted', () => {
        expect(normalizeActionForStage('before')).toBe('block');
        expect(normalizeActionForStage('after')).toBe('block_notify');
    });

    it('downgrades invalid stage/action pairs', () => {
        expect(normalizeActionForStage('before', 'force_digest')).toBe('block');
        expect(normalizeActionForStage('after', 'skip_llm')).toBe('block_notify');
    });
});

describe('evaluateContentFilter', () => {
    it('returns null when config empty', () => {
        expect(evaluateContentFilter(null, { stage: 'before', title: 'x' }).hit).toBeNull();
    });

    it('matches before keyword', () => {
        const result = evaluateContentFilter(sampleConfig, {
            stage: 'before',
            title: 'XX 新款显卡发布',
        });
        expect(result.hit?.ruleId).toBe('spam-gpu');
        expect(result.hit?.action).toBe('block');
    });

    it('matches after regex on llmSummary', () => {
        const result = evaluateContentFilter(sampleConfig, {
            stage: 'after',
            title: '正常标题',
            llmSummary: '这是一则推广内容',
        });
        expect(result.hit?.ruleId).toBe('post-marketing');
        expect(result.hit?.action).toBe('block_notify');
    });

    it('skips disabled rules', () => {
        const result = evaluateContentFilter(sampleConfig, {
            stage: 'before',
            title: 'ignore-me headline',
        });
        expect(result.hit).toBeNull();
    });

    it('respects stage isolation', () => {
        const result = evaluateContentFilter(sampleConfig, {
            stage: 'before',
            title: '推广标题',
            llmSummary: '推广',
        });
        expect(result.hit).toBeNull();
    });

    it('regex with g flag still matches every field (cached regex is state-free)', () => {
        // 回归：曾用 pattern:flags 缓存 RegExp，'g' 的 lastIndex 跨 test() 推进导致漏报
        const config: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'g-flag',
                    enabled: true,
                    stage: 'before',
                    action: 'block',
                    match: {
                        type: 'regex',
                        fields: ['title', 'snippet'],
                        pattern: 'bad',
                        flags: 'g',
                    },
                },
            ],
        };
        // 第一条字段先命中会命中；这里让 title 不含、snippet 含，验证从 lastIndex=0 之外的位置仍可命中
        const result = evaluateContentFilter(config, {
            stage: 'before',
            title: 'clean title',
            snippet: 'prefix bad suffix',
        });
        expect(result.hit?.ruleId).toBe('g-flag');

        // 连续两次 evaluate（新 cache，但同 isolate 内复用编译逻辑）都应一致命中
        const again = evaluateContentFilter(config, {
            stage: 'before',
            title: 'clean title',
            snippet: 'prefix bad suffix',
        });
        expect(again.hit?.ruleId).toBe('g-flag');
    });
});

describe('dispatchContentFilterAction', () => {
    it('stops on block and block_notify', () => {
        expect(
            dispatchContentFilterAction({
                ruleId: 'a',
                stage: 'before',
                action: 'block',
                message: '',
            }),
        ).toBe('stop');
        expect(
            dispatchContentFilterAction({
                ruleId: 'b',
                stage: 'after',
                action: 'block_notify',
                message: '',
            }),
        ).toBe('stop');
    });

    it('continues on tag_only', () => {
        expect(
            dispatchContentFilterAction({
                ruleId: 'c',
                stage: 'before',
                action: 'tag_only',
                message: '',
            }),
        ).toBe('continue');
    });
});

describe('shouldContinuePipeline / shouldStopPipeline', () => {
    it('continues when no hit', () => {
        expect(shouldContinuePipeline(null)).toBe(true);
        expect(shouldStopPipeline(null)).toBe(false);
    });

    it('stops on block hit', () => {
        const hit = {
            ruleId: 'x',
            stage: 'before' as const,
            action: 'block' as const,
            message: '',
        };
        expect(shouldContinuePipeline(hit)).toBe(false);
        expect(shouldStopPipeline(hit)).toBe(true);
    });
});

describe('contentFilterKvKey', () => {
    it('builds scoped key', () => {
        expect(contentFilterKvKey('before', 'hacker-news')).toBe(
            'content-filter:before:hacker-news',
        );
    });
});

describe('emptyContentFilterConfig', () => {
    it('returns version 1 with empty rules', () => {
        expect(emptyContentFilterConfig()).toEqual({ version: 1, rules: [] });
    });
});

describe('validateContentFilterConfig', () => {
    it('accepts valid config', () => {
        expect(() => validateContentFilterConfig(sampleConfig)).not.toThrow();
    });

    it('rejects duplicate rule ids', () => {
        const bad: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'dup',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'keyword', fields: ['title'], values: ['x'] },
                },
                {
                    id: 'dup',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'keyword', fields: ['title'], values: ['y'] },
                },
            ],
        };
        expect(() => validateContentFilterConfig(bad)).toThrow(/重复规则 id/);
    });

    it('enforces stage option when saving scoped config', () => {
        const beforeOnly: ContentFilterConfig = {
            version: 1,
            rules: [sampleConfig.rules[0]],
        };
        expect(() => validateContentFilterConfig(beforeOnly, { stage: 'before' })).not.toThrow();
        expect(() => validateContentFilterConfig(beforeOnly, { stage: 'after' })).toThrow(
            /stage 须为 after/,
        );
    });

    it('rejects invalid regex', () => {
        const bad: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'bad-regex',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'regex', fields: ['title'], pattern: '[unclosed' },
                },
            ],
        };
        expect(() => validateContentFilterConfig(bad)).toThrow(/正则无效/);
    });

    it('rejects stateful g/y flags', () => {
        const bad: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'stateful',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'regex', fields: ['title'], pattern: 'x', flags: 'g' },
                },
            ],
        };
        expect(() => validateContentFilterConfig(bad)).toThrow(/不允许 g\/y/);
    });

    it('rejects overlong and nested-quantifier patterns (ReDoS guard)', () => {
        const nested: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'nested',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'regex', fields: ['title'], pattern: '(a+)+$' },
                },
            ],
        };
        expect(() => validateContentFilterConfig(nested)).toThrow(/回溯风险|嵌套/);

        const long: ContentFilterConfig = {
            version: 1,
            rules: [
                {
                    id: 'long',
                    enabled: true,
                    stage: 'before',
                    match: { type: 'regex', fields: ['title'], pattern: `a${'a?'.repeat(400)}` },
                },
            ],
        };
        expect(() => validateContentFilterConfig(long)).toThrow(/回溯风险|过|long/);
    });
});
