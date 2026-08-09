/**
 * PDF 链接判定：纯 URL 启发式，不发起网络请求。
 * 上游：invest-rss / email-rule 正文抓取编排。
 * 下游：跳过 bare/browser fetch，回退 snippet 并说明。
 * 不变量：路径或完整 URL 以 .pdf 结尾（可含 query/hash）即视为 PDF。
 */

const PDF_EXT_RE = /\.pdf(?:[?#]|$)/i;

/** 纯函数：URL 是否为 PDF 直链（不发起网络请求） */
export function isPdfUrl(url: string): boolean {
    if (!url?.trim()) {
        return false;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return false;
        }
        return PDF_EXT_RE.test(u.pathname) || PDF_EXT_RE.test(u.href);
    } catch {
        return false;
    }
}

/** 给人/LLM 看的说明文案 */
export function describePdfLink(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return `链接为 PDF（${host}），未抓取正文`;
    } catch {
        return '链接为 PDF，未抓取正文';
    }
}
