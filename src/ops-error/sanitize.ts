export type LogFields = Record<string, unknown>;

/**
 * 精确命中表（归一化：小写去分隔符后全等）。
 * 覆盖无法靠分词命中的形态：api_key/apiKey 归一为 apikey、messageId 分词后无敏感段。
 */
const SENSITIVE_KEYS_EXACT = new Set(['apikey', 'messageid']);

/**
 * 分词命中表：camelCase / snake_case / kebab-case 切分后任一段命中即脱敏。
 * 覆盖 authToken / userEmail / apiKeyId / rawBody / notifyTo 等变体键。
 * 注意：error/message 不在内——运维日志的 error 正文是排障主载荷，泄漏面由
 * ops-error 告警邮件侧的截断兜底，而不是在这里把日志打哑。
 */
const SENSITIVE_KEY_TOKENS = new Set([
    'email',
    'from',
    'to',
    'subject',
    'body',
    'html',
    'text',
    'token',
    'authorization',
    'auth',
    'password',
    'passwd',
    'secret',
    'apikey',
    'credential',
    'cookie',
    'headers',
    'header',
    'rawbody',
    'payload',
    'content',
    'snippet',
    'prompt',
]);

/**
 * 子串命中表：在归一化（小写、去分隔符）键名上做 contains 匹配。
 * 覆盖分词切不开的复合形态：apiKeyId（api+key+id）、accessToken、secretId 等。
 * 只收列语义无歧义的 secret 词根，避免 token 化误伤（如 topic/total）。
 */
const SENSITIVE_KEY_SUBSTRINGS = [
    'token',
    'apikey',
    'secret',
    'password',
    'passwd',
    'credential',
    'cookie',
    'authorization',
    'bearer',
];

function segmentKey(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_KEYS_EXACT.has(normalized)) {
        return true;
    }
    for (const needle of SENSITIVE_KEY_SUBSTRINGS) {
        if (normalized.includes(needle)) {
            return true;
        }
    }
    return segmentKey(key).some((token) => SENSITIVE_KEY_TOKENS.has(token));
}

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function sanitizeValue(value: unknown): unknown {
    if (value == null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }
    // Date / Map / class instance 等非纯对象原样透传，避免被展开破坏
    if (!isPlainObject(value)) {
        return value;
    }
    return sanitizeForLog(value as LogFields);
}

/** 日志/告警 context 中剔除敏感字段：键名分词匹配 + 数组内对象递归 */
export function sanitizeForLog(fields: LogFields = {}): LogFields {
    const out: LogFields = {};
    for (const [key, value] of Object.entries(fields)) {
        if (isSensitiveKey(key)) {
            out[key] = '[redacted]';
            continue;
        }
        out[key] = sanitizeValue(value);
    }
    return out;
}
