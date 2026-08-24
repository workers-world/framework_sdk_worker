/**
 * 产品落地页 URL 判定：纯 URL 启发式，不发起网络请求。
 * 上游：email-rule / invest-rss 正文抓取编排（meta 轻抓路径）。
 * 下游：fetchPageMeta 或 product_landing 降级说明。
 * 不变量：根路径 / 单段短 slug 且非文章路径/已知文章站 → true。
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

function isArticleLikeSingleSegmentSlug(seg: string): boolean {
    const parts = seg.split('-').filter(Boolean);
    const hyphenCount = parts.length - 1;
    if (hyphenCount < 2) {
        return false;
    }
    const maxPartLen = Math.max(...parts.map((p) => p.length));
    const lastPartLen = parts[parts.length - 1]?.length ?? 0;
    // 连字符数量 alone 不足以判定（如 start-your-free-trial 仍是营销页）；
    // 需长词/长尾段，或 ≥5 个词段的标题式 slug
    return maxPartLen >= 12 || lastPartLen >= 9 || parts.length >= 5;
}

/** 纯函数：URL 是否像产品落地页（根路径或单段营销页） */
export function isLikelyProductLandingUrl(url: string): boolean {
    if (!url?.trim()) {
        return false;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return false;
        }
        if (isArticleHost(u.hostname)) {
            return false;
        }

        const segments = pathSegments(u.pathname);
        if (segments.some((seg) => ARTICLE_PATH_SEGMENTS.has(seg) || DATE_SEGMENT_RE.test(seg))) {
            return false;
        }

        // 根路径或 /index.html
        if (segments.length === 0) {
            return true;
        }
        if (segments.length === 1 && INDEX_FILES.has(segments[0])) {
            return true;
        }

        // 单段短 slug（如 /pricing、/app），排除过长、带扩展名、或多连字符的文章标题路径
        if (segments.length === 1) {
            const seg = segments[0];
            if (seg.includes('.') && !INDEX_FILES.has(seg)) {
                return false;
            }
            // 过长 slug 更像文章标题路径
            if (seg.length > 48) {
                return false;
            }
            if (isArticleLikeSingleSegmentSlug(seg)) {
                return false;
            }
            return true;
        }

        return false;
    } catch {
        return false;
    }
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
