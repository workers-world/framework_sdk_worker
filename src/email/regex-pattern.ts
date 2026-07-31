/**
 * 将规则中的正则编译为 JS RegExp。
 * 支持 PCRE 风格前缀 (?i) → RegExp 的 i 标志（JS 不支持内联 (?i)）。
 */
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

    return new RegExp(source, flags);
}

export function tryCompileEmailPattern(pattern: string, field: string): RegExp {
    try {
        return compileEmailPattern(pattern);
    } catch {
        throw new Error(`${field} 正则无效: ${pattern}`);
    }
}
