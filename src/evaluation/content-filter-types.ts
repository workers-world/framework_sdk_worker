/**
 * Content filter 领域类型：before/after 阶段、action、规则配置与匹配结果。
 * 上游：content-filter 匹配与 dispatch
 * 下游：email-rule / invest-rss Worker 流水线
 */

export type ContentFilterStage = 'before' | 'after';

export type ContentFilterAction =
    | 'block'
    | 'skip_llm'
    | 'block_notify'
    | 'force_digest'
    | 'force_alert'
    | 'tag_only';

export type ContentFilterField = 'title' | 'snippet' | 'body' | 'llmSummary' | 'llmTags';

export interface ContentFilterMatchKeyword {
    type: 'keyword';
    fields: ContentFilterField[];
    values: string[];
    caseInsensitive?: boolean;
}

export interface ContentFilterMatchRegex {
    type: 'regex';
    fields: ContentFilterField[];
    pattern: string;
    flags?: string;
}

export type ContentFilterMatch = ContentFilterMatchKeyword | ContentFilterMatchRegex;

export interface ContentFilterRule {
    id: string;
    enabled: boolean;
    stage: ContentFilterStage;
    action?: ContentFilterAction;
    match: ContentFilterMatch;
}

export interface ContentFilterConfig {
    version: number;
    rules: ContentFilterRule[];
}

export interface ContentFilterInput {
    stage: ContentFilterStage;
    title: string;
    snippet?: string;
    body?: string;
    llmSummary?: string;
    llmTags?: string[];
}

export interface FilterHit {
    ruleId: string;
    stage: ContentFilterStage;
    action: ContentFilterAction;
    message: string;
}

export interface ContentFilterResult {
    hit: FilterHit | null;
}

/** 流水线是否应继续（未命中或 tag_only） */
export type ContentFilterOutcome = 'continue' | 'stop';

export type ContentFilterHandler = (hit: FilterHit) => ContentFilterOutcome;
