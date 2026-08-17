/**
 * Content filter 匹配引擎与 action dispatch（MVP：block / block_notify）。
 * 上游：Worker 从 KV 加载 ContentFilterConfig
 * 下游：流水线 gate（skip LLM / skip notify）
 * 不变量：KV 读取失败由调用方 fail-open；未注册 action fail-safe 为 stop
 */
import type {
    ContentFilterAction,
    ContentFilterConfig,
    ContentFilterField,
    ContentFilterHandler,
    ContentFilterInput,
    ContentFilterMatch,
    ContentFilterOutcome,
    ContentFilterResult,
    ContentFilterRule,
    ContentFilterStage,
    FilterHit,
} from './content-filter-types.js';

export type {
    ContentFilterAction,
    ContentFilterConfig,
    ContentFilterField,
    ContentFilterHandler,
    ContentFilterInput,
    ContentFilterMatch,
    ContentFilterOutcome,
    ContentFilterResult,
    ContentFilterRule,
    ContentFilterStage,
    FilterHit,
} from './content-filter-types.js';

const BEFORE_ACTIONS = new Set<ContentFilterAction>(['block', 'skip_llm', 'tag_only']);
const AFTER_ACTIONS = new Set<ContentFilterAction>([
    'block_notify',
    'force_digest',
    'force_alert',
    'tag_only',
]);

/** stage 默认 action：before→block，after→block_notify */
export function defaultActionForStage(stage: ContentFilterStage): ContentFilterAction {
    return stage === 'before' ? 'block' : 'block_notify';
}

/** 校验 action 与 stage 合法性；非法组合降级并返回修正值 */
export function normalizeActionForStage(
    stage: ContentFilterStage,
    action?: ContentFilterAction,
): ContentFilterAction {
    const resolved = action ?? defaultActionForStage(stage);
    const allowed = stage === 'before' ? BEFORE_ACTIONS : AFTER_ACTIONS;
    if (allowed.has(resolved)) {
        return resolved;
    }
    return defaultActionForStage(stage);
}

export function shouldContinuePipeline(hit: FilterHit | null): boolean {
    return hit === null || hit.action === 'tag_only';
}

function fieldValue(input: ContentFilterInput, field: ContentFilterField): string {
    switch (field) {
        case 'title':
            return input.title ?? '';
        case 'snippet':
            return input.snippet ?? '';
        case 'body':
            return input.body ?? '';
        case 'llmSummary':
            return input.llmSummary ?? '';
        case 'llmTags':
            return (input.llmTags ?? []).join(' ');
        default:
            return '';
    }
}

function matchesKeyword(
    match: Extract<ContentFilterMatch, { type: 'keyword' }>,
    input: ContentFilterInput,
): boolean {
    const insensitive = match.caseInsensitive !== false;
    for (const field of match.fields) {
        const raw = fieldValue(input, field);
        const haystack = insensitive ? raw.toLowerCase() : raw;
        for (const value of match.values) {
            const needle = insensitive ? value.toLowerCase() : value;
            if (needle && haystack.includes(needle)) {
                return true;
            }
        }
    }
    return false;
}

function matchesRegex(
    match: Extract<ContentFilterMatch, { type: 'regex' }>,
    input: ContentFilterInput,
    compiled?: RegExp,
): boolean {
    const regex = compiled ?? new RegExp(match.pattern, match.flags ?? 'i');
    for (const field of match.fields) {
        const value = fieldValue(input, field);
        if (value && regex.test(value)) {
            return true;
        }
    }
    return false;
}

function matchesRule(
    rule: ContentFilterRule,
    input: ContentFilterInput,
    regexCache?: Map<string, RegExp>,
): boolean {
    if (rule.match.type === 'keyword') {
        return matchesKeyword(rule.match, input);
    }
    const cacheKey = `${rule.match.pattern}:${rule.match.flags ?? 'i'}`;
    let compiled = regexCache?.get(cacheKey);
    if (!compiled) {
        try {
            compiled = new RegExp(rule.match.pattern, rule.match.flags ?? 'i');
            regexCache?.set(cacheKey, compiled);
        } catch {
            return false;
        }
    }
    return matchesRegex(rule.match, input, compiled);
}

/** 对配置规则做首条命中匹配；无 config 或未命中返回 hit=null */
export function evaluateContentFilter(
    config: ContentFilterConfig | null | undefined,
    input: ContentFilterInput,
): ContentFilterResult {
    if (!config?.rules?.length) {
        return {hit: null};
    }

    const regexCache = new Map<string, RegExp>();
    for (const rule of config.rules) {
        if (!rule.enabled || rule.stage !== input.stage) {
            continue;
        }
        if (!matchesRule(rule, input, regexCache)) {
            continue;
        }
        const action = normalizeActionForStage(rule.stage, rule.action);
        return {
            hit: {
                ruleId: rule.id,
                stage: rule.stage,
                action,
                message: `matched rule ${rule.id}`,
            },
        };
    }
    return {hit: null};
}

const DEFAULT_HANDLERS: Partial<Record<ContentFilterAction, ContentFilterHandler>> = {
    block: () => 'stop',
    block_notify: () => 'stop',
    skip_llm: () => 'continue',
    tag_only: () => 'continue',
    force_digest: () => 'stop',
    force_alert: () => 'stop',
};

/**
 * 根据 hit.action 分发后续步骤；MVP 未实现的 force_* fail-safe 为 stop。
 * @returns continue=流水线继续；stop=终止（不调 LLM 或不 notify）
 */
export function dispatchContentFilterAction(
    hit: FilterHit,
    handlers?: Partial<Record<ContentFilterAction, ContentFilterHandler>>,
): ContentFilterOutcome {
    const handler = handlers?.[hit.action] ?? DEFAULT_HANDLERS[hit.action];
    if (!handler) {
        return 'stop';
    }
    return handler(hit);
}

/** 是否应终止当前流水线阶段（block / block_notify / 未注册 action） */
export function shouldStopPipeline(hit: FilterHit | null): boolean {
    if (!hit) {
        return false;
    }
    return dispatchContentFilterAction(hit) === 'stop';
}

/** KV key：content-filter:{stage}:{ruleScope} */
export function contentFilterKvKey(stage: ContentFilterStage, ruleScope: string): string {
    return `content-filter:${stage}:${ruleScope}`;
}

const ALLOWED_MATCH_FIELDS = new Set<ContentFilterField>([
    'title',
    'snippet',
    'body',
    'llmSummary',
    'llmTags',
]);

export interface ValidateContentFilterOptions {
    stage?: ContentFilterStage;
    maxRules?: number;
}

/** Admin 保存前校验；非法配置抛 Error */
export function validateContentFilterConfig(
    config: ContentFilterConfig,
    options: ValidateContentFilterOptions = {},
): void {
    if (config?.version !== 1) {
        throw new Error('config.version 须为 1');
    }
    if (!Array.isArray(config.rules)) {
        throw new Error('config.rules 须为数组');
    }
    const maxRules = options.maxRules ?? 200;
    if (config.rules.length > maxRules) {
        throw new Error(`规则数量不得超过 ${maxRules}`);
    }

    const ids = new Set<string>();
    for (const rule of config.rules) {
        if (!rule.id?.trim()) {
            throw new Error('规则 id 不能为空');
        }
        if (ids.has(rule.id)) {
            throw new Error(`重复规则 id: ${rule.id}`);
        }
        ids.add(rule.id);

        if (rule.stage !== 'before' && rule.stage !== 'after') {
            throw new Error(`规则 ${rule.id} stage 无效`);
        }
        if (options.stage && rule.stage !== options.stage) {
            throw new Error(`规则 ${rule.id} stage 须为 ${options.stage}`);
        }

        normalizeActionForStage(rule.stage, rule.action);

        const match = rule.match;
        if (match.type === 'keyword') {
            if (!match.fields?.length) {
                throw new Error(`规则 ${rule.id} 须指定 match.fields`);
            }
            for (const field of match.fields) {
                if (!ALLOWED_MATCH_FIELDS.has(field)) {
                    throw new Error(`规则 ${rule.id} field 无效: ${field}`);
                }
            }
            if (!match.values?.length || match.values.every((v) => !v.trim())) {
                throw new Error(`规则 ${rule.id} keyword values 不能为空`);
            }
        } else if (match.type === 'regex') {
            if (!match.fields?.length) {
                throw new Error(`规则 ${rule.id} 须指定 match.fields`);
            }
            if (!match.pattern?.trim()) {
                throw new Error(`规则 ${rule.id} regex pattern 不能为空`);
            }
            try {
                new RegExp(match.pattern, match.flags ?? 'i');
            } catch {
                throw new Error(`规则 ${rule.id} 正则无效`);
            }
        } else {
            throw new Error(`规则 ${rule.id} match.type 无效`);
        }
    }
}

export function emptyContentFilterConfig(): ContentFilterConfig {
    return {version: 1, rules: []};
}
