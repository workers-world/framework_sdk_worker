export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN =
    /^(email|from|to|subject|body|html|text|token|authorization|password|secret|apikey|api_key|originaltext|originalhtml|messageid|notifyto|alertto)$/i;

/** 日志/告警 context 中剔除敏感字段 */
export function sanitizeForLog(fields: LogFields = {}): LogFields {
    const out: LogFields = {};
    for (const [key, value] of Object.entries(fields)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            out[key] = '[redacted]';
            continue;
        }
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = sanitizeForLog(value as LogFields);
            continue;
        }
        out[key] = value;
    }
    return out;
}
