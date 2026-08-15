import { escapeHtml } from './escape-html.js';

/**
 * 将纯文本正文转为可点击链接的简易 HTML（运维告警邮件用）。
 * 先 escapeHtml，再把 http(s) URL 包成 `<a href>`；用 white-space:pre-wrap 保留换行。
 */
const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** 去掉 URL 尾部常见标点（句号、逗号等），避免链进邮箱客户端时带上多余字符 */
function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
    let url = raw;
    let trailing = '';
    while (/[.,;:!?)]$/.test(url) && !url.endsWith('://')) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
    }
    return { url, trailing };
}

export function linkifyPlainTextEmail(text: string): string {
    const escaped = escapeHtml(text);
    const withLinks = escaped.replace(URL_RE, (match) => {
        const { url, trailing } = splitTrailingPunctuation(match);
        if (!url) {
            return match;
        }
        // href 与可见文本均已 escape；URL 内无未转义的 <>&"
        return `<a href="${url}">${url}</a>${trailing}`;
    });
    return `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap">${withLinks}</div>`;
}
