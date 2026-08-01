import {describe, expect, it} from 'vitest';
import {
    contentFilterKvKey,
    defaultActionForStage,
    dispatchContentFilterAction,
    evaluateContentFilter,
    normalizeActionForStage,
    shouldContinuePipeline,
    shouldStopPipeline,
    type ContentFilterConfig,
} from './content-filter.js';

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
            match: {type: 'keyword', fields: ['title'], values: ['ignore-me']},
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
        expect(evaluateContentFilter(null, {stage: 'before', title: 'x'}).hit).toBeNull();
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
});

describe('dispatchContentFilterAction', () => {
    it('stops on block and block_notify', () => {
        expect(dispatchContentFilterAction({
            ruleId: 'a',
            stage: 'before',
            action: 'block',
            message: '',
        })).toBe('stop');
        expect(dispatchContentFilterAction({
            ruleId: 'b',
            stage: 'after',
            action: 'block_notify',
            message: '',
        })).toBe('stop');
    });

    it('continues on tag_only', () => {
        expect(dispatchContentFilterAction({
            ruleId: 'c',
            stage: 'before',
            action: 'tag_only',
            message: '',
        })).toBe('continue');
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
        expect(contentFilterKvKey('before', 'hacker-news')).toBe('content-filter:before:hacker-news');
    });
});
