/**
 * 摘要路径决策 because= 常量表（日志 / QualityIncident）。
 * 上游：email-rule summarize.resolveTitleOnlyDecision
 * 下游：quality-incident Hard Evaluator、质量 CSV
 * 不变量：code 稳定英文；zh 仅供检视，不写入对外契约字段
 */

export const SummaryDecisionBecause = {
    usable_body: {
        code: 'usable_body',
        zh: '正文可用，走 LLM',
    },
    product_landing_llm: {
        code: 'product_landing_llm',
        zh: '产品落地页/仅 meta，仍走 LLM',
    },
    quality_soft_reject: {
        code: 'quality_soft_reject',
        zh: 'Browser 软保留正文，仍走 LLM',
    },
    article_url_bypass: {
        code: 'article_url_bypass',
        zh: '抓取失败但 URL 像文章，强制 LLM',
    },
    video_link: {
        code: 'video_link',
        zh: '视频链接，仅标题摘要',
    },
    pdf_link: {
        code: 'pdf_link',
        zh: 'PDF 链接，仅标题摘要',
    },
    binary_body: {
        code: 'binary_body',
        zh: '正文像二进制/非文本，仅标题摘要',
    },
    nav_shell_body: {
        code: 'nav_shell_body',
        zh: '抓取失败且正文像导航壳，仅标题摘要',
    },
    thin_snippet: {
        code: 'thin_snippet',
        zh: '抓取失败且邮件片段过薄，仅标题摘要',
    },
    paywall: {
        code: 'paywall',
        zh: '注册墙/付费墙，仅标题摘要',
    },
} as const;

export type SummaryDecisionBecauseCode =
    (typeof SummaryDecisionBecause)[keyof typeof SummaryDecisionBecause]['code'];

export function describeSummaryDecisionBecause(code: string): string {
    const hit = Object.values(SummaryDecisionBecause).find((x) => x.code === code);
    return hit ? `${hit.code}（${hit.zh}）` : code;
}
