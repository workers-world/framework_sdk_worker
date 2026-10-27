/**
 * 正文质检子原因 detail= 常量表（Browser/bare 拒绝说明）。
 * 上游：describeQualityReject(text) 判因
 * 下游：抓取日志 detail=、soft_keep 白名单分支
 * 不变量：code 稳定英文；zh 仅供检视
 */

export const QualityRejectDetail = {
    empty: { code: 'empty', zh: '正文为空' },
    nav_shell: { code: 'nav_shell', zh: '站点导航壳/目录页' },
    thin: { code: 'thin', zh: '正文过薄' },
    cookie: { code: 'cookie', zh: 'Cookie/同意墙文案' },
    junk: { code: 'junk', zh: '垃圾标记命中' },
    paywall: { code: 'paywall', zh: '付费墙/注册墙（需登录/订阅/注册）' },
    binary_content: { code: 'binary_content', zh: '二进制或非文本' },
} as const;

export type QualityRejectDetailCode =
    (typeof QualityRejectDetail)[keyof typeof QualityRejectDetail]['code'];

/** soft_keep 仅允许这些子原因；nav_shell/cookie/junk 等硬拒绝 */
export const QUALITY_SOFT_KEEP_DETAILS: ReadonlySet<QualityRejectDetailCode> = new Set([
    QualityRejectDetail.thin.code,
    QualityRejectDetail.paywall.code,
]);

export function describeQualityRejectDetail(code: string): string {
    const hit = Object.values(QualityRejectDetail).find((x) => x.code === code);
    return hit ? `${hit.code}（${hit.zh}）` : code;
}

export function isQualitySoftKeepDetail(code: string): boolean {
    return QUALITY_SOFT_KEEP_DETAILS.has(code as QualityRejectDetailCode);
}
