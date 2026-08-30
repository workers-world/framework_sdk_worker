/**
 * HTML 文本/属性转义。覆盖 & < > " ' 五个上下文敏感字符：
 * 单引号用于单引号属性上下文（当前内部用法是双引号属性，导出工具必须完备）。
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
