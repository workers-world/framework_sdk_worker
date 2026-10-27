/**
 * 视频链接判定：纯 URL 启发式，不发起网络请求。
 * 上游：invest-rss / email-rule 正文抓取编排。
 * 下游：跳过 bare/browser fetch，回退 snippet 并说明。
 * 不变量：已知视频站主机、直链扩展名命中即视为视频。
 */

const VIDEO_HOST_SUFFIXES = [
    'youtube.com',
    'youtu.be',
    'bilibili.com',
    'b23.tv',
    'vimeo.com',
    'tiktok.com',
    'douyin.com',
    'twitch.tv',
    'dailymotion.com',
    'youku.com',
    'iqiyi.com',
];

const VIDEO_EXT_RE = /\.(mp4|webm|m3u8|mov|mkv|avi)(?:[?#]|$)/i;

function hostMatchesVideo(hostname: string): boolean {
    const host = hostname.replace(/^www\./, '').toLowerCase();
    return VIDEO_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** 纯函数：URL 是否为视频站或视频直链（不发起网络请求） */
export function isVideoUrl(url: string): boolean {
    if (!url?.trim()) {
        return false;
    }
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return false;
        }
        if (hostMatchesVideo(u.hostname)) {
            return true;
        }
        if (VIDEO_EXT_RE.test(u.pathname) || VIDEO_EXT_RE.test(u.href)) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/** 给人/LLM 看的说明文案 */
export function describeVideoLink(url: string): string {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return `链接为视频（${host}），未抓取正文`;
    } catch {
        return '链接为视频，未抓取正文';
    }
}
