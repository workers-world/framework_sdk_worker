/**
 * 正文抓取 reason= 常量表（【正文抓取】日志 / chain 段）。
 * 上游：email-rule / invest-rss fetch-article-*、article-body
 * 下游：pipeline 日志、摘要链路 chain=
 * 不变量：code 稳定英文；zh 仅供检视
 */

export const ArticleFetchReason = {
    ok: { code: 'ok', zh: '抓取成功，正文可用' },
    hit: { code: 'hit', zh: '命中正文缓存' },
    cookie: { code: 'cookie', zh: 'Cookie/同意墙样板文' },
    junk: { code: 'junk', zh: '垃圾/无意义正文' },
    thin: { code: 'thin', zh: '正文过薄' },
    binary_content: { code: 'binary_content', zh: '二进制或非文本内容' },
    quality_rejected: { code: 'quality_rejected', zh: '质检硬拒绝（不可用）' },
    rate_limit: { code: 'rate_limit', zh: 'Browser/抓取限流' },
    render_error: { code: 'render_error', zh: 'Browser 渲染失败' },
    http_error: { code: 'http_error', zh: 'HTTP 错误状态' },
    timeout: { code: 'timeout', zh: '抓取超时' },
    disabled: { code: 'disabled', zh: 'Browser 未启用' },
    non_text_content_type: { code: 'non_text_content_type', zh: 'Content-Type 非文本' },
    network: { code: 'network', zh: '网络错误' },
    video_link: { code: 'video_link', zh: '判定为视频链接，跳过抓取' },
    pdf_link: { code: 'pdf_link', zh: '判定为 PDF，跳过抓取' },
    product_landing: {
        code: 'product_landing',
        zh: '产品落地页（无可用 meta），用邮件片段',
    },
    product_landing_meta: {
        code: 'product_landing_meta',
        zh: '产品落地页，仅用 meta/可见文案',
    },
    quality_soft_reject: {
        code: 'quality_soft_reject',
        zh: '质检未过但软保留正文',
    },
} as const;

export type ArticleFetchReasonCode =
    (typeof ArticleFetchReason)[keyof typeof ArticleFetchReason]['code'];

export function describeArticleFetchReason(code: string): string {
    const hit = Object.values(ArticleFetchReason).find((x) => x.code === code);
    return hit ? `${hit.code}（${hit.zh}）` : code;
}
