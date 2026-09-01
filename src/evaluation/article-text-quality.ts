/**
 * 抓取正文与邮件 snippet 的质量判定（薄正文、导航壳、Cookie 同意页、二进制、付费/注册墙）。
 * 上游：无
 * 下游：email-rule / invest-rss fetch-article*、article-body、summarize
 * 不变量：纯函数无副作用；isUsableFetchedText 比 isUsableExtractedSnippet 更严格
 */
import {
    type QualityRejectDetailCode,
    QualityRejectDetail as QualityRejectDetailTable,
} from './quality-reject-detail.js';

const THIN_BODY_MAX_CHARS = 400;

const AGGREGATOR_MARKERS = [
    /(^|[/:.])(?:[a-z0-9-]+\.)*blogtrottr\.com(?=$|[/:?#\s])/i,
    /you are receiving this email because you subscribed/i,
    /if you no longer wish to receive these emails/i,
    /at yahoo finance, you get free stock quotes/i,
    /media files:/i,
    /links for the intellectually curious/i,
    /^hacker news$/im,
];

const PAYWALL_MARKERS = [
    /subscribe to read/i,
    /sign in to read/i,
    /register for free to continue reading/i,
    /sign up for free to continue reading/i,
    /create (a )?free account to continue/i,
];

const FETCH_JUNK_MARKERS = [
    /sad-panda/i,
    /no longer be accessible from mainland china/i,
    /please enable javascript/i,
    ...PAYWALL_MARKERS,
];

const CONSENT_MARKERS = [
    /cookie-richtlinie/i,
    /datenschutzeinstellungen/i,
    /alle akzeptieren/i,
    /alle ablehnen/i,
    /iab transparency/i,
    /consent framework/i,
    /cookie policy/i,
    /we use cookies/i,
    /manage privacy/i,
    /accept all/i,
    /privacy settings/i,
    /technische identifikationsmerkmale/i,
];

export function stripAggregatorEmailNoise(text: string): string {
    let cleaned = text.replace(/\r\n/g, '\n').trim();
    const cutPatterns = [
        /\nYou are receiving this email because[\s\S]*/i,
        /\nIf you no longer wish to receive these emails[\s\S]*/i,
        /\nMedia files:\n[\s\S]*/i,
    ];
    for (const pattern of cutPatterns) {
        cleaned = cleaned.replace(pattern, '').trim();
    }
    cleaned = cleaned
        .replace(/^Yahoo Finance\nAt Yahoo Finance, you get free stock quotes[\s\S]*?\n\n/m, '')
        .replace(/^Hacker News\nLinks for the intellectually curious[\s\S]*?\n\n/m, '')
        .replace(/\n+Comments\s*$/i, '')
        .trim();
    return cleaned;
}

export function isConsentOrBoilerplateText(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const hits = CONSENT_MARKERS.filter((re) => re.test(normalized)).length;
    if (hits >= 2) {
        return true;
    }
    if (hits >= 1 && normalized.length < 2500) {
        const consentKeywords = ['cookie', 'datenschutz', 'consent', 'privacy', 'akzeptieren'];
        const keywordHits = consentKeywords.filter((k) =>
            normalized.toLowerCase().includes(k),
        ).length;
        if (keywordHits >= 3) {
            return true;
        }
    }
    return false;
}

export function isThinArticleBody(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 80) {
        return true;
    }
    const markerHits = AGGREGATOR_MARKERS.filter((re) => re.test(text)).length;
    if (markerHits >= 2) {
        return true;
    }
    if (normalized.length <= THIN_BODY_MAX_CHARS && markerHits >= 1) {
        return true;
    }
    const urlCount = (text.match(/https?:\/\//gi) || []).length;
    if (urlCount >= 1 && normalized.length < 500) {
        const withoutUrls = normalized.replace(/https?:\/\/\S+/g, '').trim();
        if (withoutUrls.length < 220) {
            return true;
        }
    }
    if (urlCount >= 2 && normalized.length < 700) {
        return true;
    }
    return false;
}

const BINARY_SAMPLE_MAX = 2048;
const MIN_PRINTABLE_RATIO = 0.85;

function printableRatio(sample: string): number {
    if (sample.length === 0) {
        return 1;
    }
    let printable = 0;
    for (let i = 0; i < sample.length; i++) {
        const code = sample.charCodeAt(i);
        if (
            (code >= 32 && code <= 126) ||
            code === 9 ||
            code === 10 ||
            code === 13 ||
            // 主要文字区段：西里尔、CJK 标点/假名/谚文兼容/CJK 统一表意、谚文、CJK 扩展 B+
            (code >= 0x0400 && code <= 0x04ff) ||
            (code >= 0x3000 && code <= 0x9fff) ||
            (code >= 0xac00 && code <= 0xd7af) ||
            code >= 0x20000
        ) {
            printable++;
        }
    }
    return printable / sample.length;
}

export function isBinaryOrNonTextContent(text: string): boolean {
    const sample = text.slice(0, BINARY_SAMPLE_MAX);
    if (!sample.trim()) {
        return false;
    }
    if (sample.includes('JFIF')) {
        return true;
    }
    if (sample.startsWith('\x89PNG') || sample.startsWith('GIF8') || sample.startsWith('%PDF')) {
        return true;
    }
    const nullCount = (sample.match(/\0/g) || []).length;
    if (nullCount > 2) {
        return true;
    }
    if (printableRatio(sample) < MIN_PRINTABLE_RATIO) {
        return true;
    }
    return false;
}

const SITE_NAV_MARKERS = [
    /行情中心/,
    /数据中心/,
    /globalNav/i,
    /\[财经\]\(/,
    /finance\.eastmoney\.com\/yaowen/i,
];

export function isSiteNavigationShell(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 120) {
        return false;
    }

    const markdownLinks = text.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? [];
    const listLinks = text.match(/^\s*[*-]\s+\[[^\]]+\]\(/gm) ?? [];
    const httpCount = (text.match(/https?:\/\//gi) || []).length;
    const navMarkerHits = SITE_NAV_MARKERS.filter((re) => re.test(text)).length;

    if (/行情中心/.test(text) && /数据中心/.test(text) && httpCount >= 6) {
        return true;
    }
    if (navMarkerHits >= 2 && httpCount >= 8) {
        return true;
    }
    if (listLinks.length >= 8 || markdownLinks.length >= 12) {
        const withoutLinks = normalized
            .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/https?:\/\/\S+/g, ' ')
            .trim();
        if (withoutLinks.length < normalized.length * 0.4) {
            return true;
        }
    }
    return false;
}

export function isUsableExtractedSnippet(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 80) {
        return false;
    }
    if (isBinaryOrNonTextContent(text)) {
        return false;
    }
    if (isSiteNavigationShell(text)) {
        return false;
    }
    if (FETCH_JUNK_MARKERS.some((re) => re.test(text))) {
        return false;
    }
    if (isConsentOrBoilerplateText(text)) {
        return false;
    }
    return true;
}

export type QualityRejectDetail = QualityRejectDetailCode;

/** 带中文描述的质检子原因表 */
export const QualityRejectDetail = QualityRejectDetailTable;

/** 质检拒绝子原因，供日志 detail= 字段 */
export function describeQualityReject(text: string): QualityRejectDetailCode {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return QualityRejectDetail.empty.code;
    }
    if (isBinaryOrNonTextContent(text)) {
        return QualityRejectDetail.binary_content.code;
    }
    if (PAYWALL_MARKERS.some((re) => re.test(normalized))) {
        return QualityRejectDetail.paywall.code;
    }
    if (isSiteNavigationShell(text)) {
        return QualityRejectDetail.nav_shell.code;
    }
    if (isConsentOrBoilerplateText(text)) {
        return QualityRejectDetail.cookie.code;
    }
    if (FETCH_JUNK_MARKERS.some((re) => re.test(text))) {
        return QualityRejectDetail.junk.code;
    }
    if (isThinArticleBody(text)) {
        return QualityRejectDetail.thin.code;
    }
    return QualityRejectDetail.junk.code;
}

export function textBodyMetrics(text: string): { bodyLen: number; linkCount: number } {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return {
        bodyLen: normalized.length,
        linkCount: (text.match(/https?:\/\//gi) || []).length,
    };
}

export function isUsableFetchedText(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length < 180) {
        return false;
    }
    if (isBinaryOrNonTextContent(text)) {
        return false;
    }
    if (isSiteNavigationShell(text)) {
        return false;
    }
    if (FETCH_JUNK_MARKERS.some((re) => re.test(text))) {
        return false;
    }
    if (isConsentOrBoilerplateText(text)) {
        return false;
    }
    return !isThinArticleBody(text);
}
