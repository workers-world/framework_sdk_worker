/**
 * 产品落地页 URL 判定（Tier 0）：纯 URL、不发起网络请求。
 * 上游：email-rule / invest-rss 正文抓取编排。
 * 下游：resolveLandingOrArticleFetch；ambiguous 单段 slug 交 meta 分类（Tier 1/2）。
 * 不变量：根路径 / 单段简单 slug → landing；≥2 连字符单段 → ambiguous；文章路径/站 → not_landing。
 */

/** 已知以长文/聚合为主的主机，不按产品落地页处理 */
const ARTICLE_HOST_SUFFIXES = [
    'medium.com',
    'substack.com',
    'github.com',
    'gitlab.com',
    'news.ycombinator.com',
    'wikipedia.org',
    'arxiv.org',
    'ssrn.com',
    'nature.com',
    'sciencedirect.com',
    'ieee.org',
    'acm.org',
    'dev.to',
    'hashnode.dev',
    'wordpress.com',
    'blogspot.com',
    'ghost.io',
    'notion.site',
    'reddit.com',
    'x.com',
    'twitter.com',
    'linkedin.com',
    'finance.yahoo.com',
    'barrons.com',
    'bloomberg.com',
    'reuters.com',
    'wsj.com',
    'ft.com',
    'eastmoney.com',
];

/** 路径段命中则视为文章/内容页，非产品落地页 */
const ARTICLE_PATH_SEGMENTS = new Set([
    'blog',
    'blogs',
    'post',
    'posts',
    'article',
    'articles',
    'news',
    'story',
    'stories',
    'p',
    'permalink',
    'entry',
    'entries',
    'archive',
    'archives',
    'tag',
    'tags',
    'category',
    'categories',
    'author',
    'authors',
    'wiki',
    'docs',
    'documentation',
    'changelog',
    'release',
    'releases',
    'pull',
    'blob',
    'tree',
    'commit',
    'issues',
    'discussions',
    'item',
    'comments',
    'thread',
    'forum',
    'forums',
]);

const DATE_SEGMENT_RE =
    /^(?:19|20)\d{2}(?:[-_/]?(?:0[1-9]|1[0-2])(?:[-_/]?(?:0[1-9]|[12]\d|3[01]))?)?$/;
const INDEX_FILES = new Set(['index.html', 'index.htm', 'index.php', 'index']);

/** Tier 0：高置信落地页 / 需 meta 探测 / 明确非落地页 */
export type LinkLandingTier = 'landing' | 'ambiguous' | 'not_landing';

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
    const host = hostname.replace(/^www\./, '').toLowerCase();
    return host === suffix || host.endsWith(`.${suffix}`);
}

function isArticleHost(hostname: string): boolean {
    return ARTICLE_HOST_SUFFIXES.some((suffix) => hostMatchesSuffix(hostname, suffix));
}

function pathSegments(pathname: string): string[] {
    return pathname
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s).toLowerCase();
            } catch {
                return s.toLowerCase();
            }
        });
}

function parseHttpUrl(url: string): URL | null {
    if (!url?.trim()) {
        return null;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return null;
        }
        return u;
    } catch {
        return null;
    }
}

/**
 * Tier 0 路由：仅高置信 case 直接判 landing；多连字符单段 slug 标记 ambiguous，
 * 由 meta 抓取后的 classifyPageMetaForFetch 决定落地页或全文抓取。
 */
export function classifyLinkLandingTier(url: string): LinkLandingTier {
    const u = parseHttpUrl(url);
    if (!u) {
        return 'not_landing';
    }
    if (isArticleHost(u.hostname)) {
        return 'not_landing';
    }

    const segments = pathSegments(u.pathname);
    if (segments.some((seg) => ARTICLE_PATH_SEGMENTS.has(seg) || DATE_SEGMENT_RE.test(seg))) {
        return 'not_landing';
    }

    if (segments.length === 0) {
        return 'landing';
    }
    if (segments.length === 1 && INDEX_FILES.has(segments[0])) {
        return 'landing';
    }

    if (segments.length !== 1) {
        return 'not_landing';
    }

    const seg = segments[0];
    if (seg.includes('.') && !INDEX_FILES.has(seg)) {
        return 'not_landing';
    }
    if (seg.length > 48) {
        return 'not_landing';
    }

    const hyphenCount = seg.split('-').filter(Boolean).length - 1;
    if (hyphenCount >= 2) {
        return 'ambiguous';
    }
    return 'landing';
}

/** 是否需先 meta 探测再定抓取路径（Tier 1） */
export function needsMetaProbeForLanding(url: string): boolean {
    return classifyLinkLandingTier(url) === 'ambiguous';
}

/** 纯函数：URL 是否像产品落地页（仅 Tier 0 高置信，不含 ambiguous） */
export function isLikelyProductLandingUrl(url: string): boolean {
    return classifyLinkLandingTier(url) === 'landing';
}

/** 给人/LLM 看的说明文案 */
export function describeProductLandingLink(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return `链接为产品落地页（${host}）`;
    } catch {
        return '链接为产品落地页';
    }
}
