/**
 * 将规则中的正则编译为 JS RegExp。
 * 支持 PCRE 风格前缀 (?i) → RegExp 的 i 标志（JS 不支持内联 (?i)）。
 * 安全约束：限长 + 拒绝嵌套量词——Workers 上灾难性回溯会烧穿 CPU 配额。
 */

/** 管理员正则长度上限 */
const PATTERN_MAX_LENGTH = 500;

/** 嵌套量词启发式：(a+)+ / (a+)* / (a+){2,} 是回溯爆炸的典型形态 */
const NESTED_QUANTIFIER_RE = /\([^()]*[+*]\)\s*[+*{]/;

/** ReDoS 防护：超长或含嵌套量词的 pattern 直接拒绝（抛 SyntaxError） */
export function assertSafeRegexPattern(pattern: string): void {
    if (pattern.length > PATTERN_MAX_LENGTH) {
        throw new SyntaxError(`pattern too long (> ${PATTERN_MAX_LENGTH})`);
    }
    if (NESTED_QUANTIFIER_RE.test(pattern)) {
        throw new SyntaxError('nested quantifier rejected (ReDoS guard)');
    }
}

export function compileEmailPattern(pattern: string): RegExp {
    let source = pattern.trim();
    let flags = '';

    if (source.startsWith('(?i)')) {
        flags = 'i';
        source = source.slice(4);
    }

    if (!source) {
        throw new SyntaxError('empty pattern');
    }

    assertSafeRegexPattern(source);
    return new RegExp(source, flags);
}

export function tryCompileEmailPattern(pattern: string, field: string): RegExp {
    try {
        return compileEmailPattern(pattern);
    } catch {
        throw new Error(`${field} 正则无效或存在回溯风险: ${pattern.slice(0, 80)}`);
    }
}
