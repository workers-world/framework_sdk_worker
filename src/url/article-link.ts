/**
 * 长文/文章 URL 判定：纯 URL 启发式，不发起网络请求。
 * 上游：email-rule summarize（title-only bypass）、正文抓取降级。
 * 下游：与 isLikelyProductLandingUrl 互斥优先判落地页。
 * 不变量：essays/blog 等路径段、已知长文站、多段长 slug → true。
 */
import {isLikelyProductLandingUrl} from './product-landing-link.js';

/** 已知以长文为主的主机 */
const ARTICLE_HOST_SUFFIXES = [
    'aeon.co',
    'longreads.com',
    'theatlantic.com',
    'newyorker.com',
    'lrb.co.uk',
    'psyche.co',
    'nautil.us',
    'quantamagazine.org',
    'scientificamerican.com',
    'arstechnica.com',
    'wired.com',
    'technologyreview.com',
];

/** 聚合/财经源：虽有 /article/ 路径但不走长文 essay bypass */
const EXCLUDED_HOST_SUFFIXES = ['finance.yahoo.com', 'news.yahoo.com', 'barrons.com'];

/** 路径段命中则视为文章页 */
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
    'essay',
    'essays',
    'magazine',
    'opinion',
    'features',
    'longread',
    'longreads',
    'p',
    'permalink',
    'entry',
    'entries',
    'archive',
    'archives',
    'eventpage',
]);

const LONG_SLUG_MIN_LEN = 20;

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
    const host = hostname.replace(/^www\./, '').toLowerCase();
    return host === suffix || host.endsWith(`.${suffix}`);
}

function isExcludedHost(hostname: string): boolean {
    return EXCLUDED_HOST_SUFFIXES.some((suffix) => hostMatchesSuffix(hostname, suffix));
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

/** 纯函数：URL 是否像长文/essay 文章页（非产品落地页） */
export function isLikelyArticleUrl(url: string): boolean {
    if (!url?.trim() || isLikelyProductLandingUrl(url)) {
        return false;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return false;
        }
        if (isExcludedHost(u.hostname)) {
            return false;
        }
        if (isArticleHost(u.hostname)) {
            return true;
        }
        const segments = pathSegments(u.pathname);
        if (segments.some((seg) => ARTICLE_PATH_SEGMENTS.has(seg))) {
            return true;
        }
        const last = segments[segments.length - 1];
        if (segments.length >= 2 && last && last.length >= LONG_SLUG_MIN_LEN) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}
