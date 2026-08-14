/**
 * 轻量页面 meta 抓取：仅 HTTP + 前 64KB HTML 解析 og/description/title。
 * 上游：email-rule / invest-rss 产品落地页路径。
 * 下游：formatPageMetaSnippet → LLM prompt 正文片段。
 * 不变量：不启 Browser；超时/非 HTML/失败 → source:'none'，不抛致命错误。
 */

export type PageMetaSource = 'og' | 'meta' | 'title' | 'none';

export interface PageMeta {
    title?: string;
    description?: string;
    siteName?: string;
    source: PageMetaSource;
}

const META_FETCH_TIMEOUT_MS = 8_000;
const META_HTML_MAX_BYTES = 64 * 1024;

function unescapeHtml(text: string): string {
    return text
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n: string) => {
            const code = Number(n);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
            const code = Number.parseInt(h, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
}

function normalizeMetaValue(raw: string | undefined): string | undefined {
    if (!raw) {
        return undefined;
    }
    const cleaned = unescapeHtml(raw).replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
}

function attrValue(tag: string, attr: string): string | undefined {
    const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const m = tag.match(re);
    return normalizeMetaValue(m?.[1] ?? m?.[2] ?? m?.[3]);
}

function extractMetaByProperty(html: string, property: string): string | undefined {
    const re = /<meta\b[^>]*>/gi;
    let match: RegExpExecArray | null = re.exec(html);
    while (match) {
        const tag = match[0];
        const prop = attrValue(tag, 'property') ?? attrValue(tag, 'name');
        if (prop && prop.toLowerCase() === property.toLowerCase()) {
            return attrValue(tag, 'content');
        }
        match = re.exec(html);
    }
    return undefined;
}

function extractTitleTag(html: string): string | undefined {
    const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return normalizeMetaValue(m?.[1]?.replace(/<[^>]+>/g, ''));
}

/** 从 HTML 片段解析 og/meta/title（纯函数，便于单测） */
export function parsePageMetaFromHtml(html: string): PageMeta {
    if (!html?.trim()) {
        return { source: 'none' };
    }

    const ogTitle = extractMetaByProperty(html, 'og:title');
    const ogDescription = extractMetaByProperty(html, 'og:description');
    const ogSiteName = extractMetaByProperty(html, 'og:site_name');
    const metaDescription = extractMetaByProperty(html, 'description');
    const titleTag = extractTitleTag(html);

    const title = ogTitle ?? titleTag;
    const description = ogDescription ?? metaDescription;
    const siteName = ogSiteName;

    if (ogTitle || ogDescription || ogSiteName) {
        return { title, description, siteName, source: 'og' };
    }
    if (metaDescription) {
        return { title, description, siteName, source: 'meta' };
    }
    if (titleTag) {
        return { title: titleTag, description, siteName, source: 'title' };
    }
    return { source: 'none' };
}

export function hasUsablePageMeta(meta: PageMeta): boolean {
    return Boolean(meta.description?.trim() || meta.title?.trim());
}

/** 将 meta 格式化为 LLM 可用的结构化片段 */
export function formatPageMetaSnippet(meta: PageMeta): string {
    const lines = ['产品落地页元信息：'];
    if (meta.siteName) {
        lines.push(`站点：${meta.siteName}`);
    }
    if (meta.title) {
        lines.push(`标题：${meta.title}`);
    }
    if (meta.description) {
        lines.push(`描述：${meta.description}`);
    }
    lines.push(`来源：${meta.source}`);
    return lines.join('\n');
}

function isRejectedContentType(contentType: string | null): boolean {
    if (!contentType) {
        return false;
    }
    const ct = contentType.toLowerCase();
    return (
        ct.includes('application/pdf') ||
        ct.startsWith('video/') ||
        ct.startsWith('audio/') ||
        ct.startsWith('image/') ||
        ct.includes('application/octet-stream')
    );
}

async function readHtmlPrefix(resp: Response, maxBytes: number): Promise<string> {
    const reader = resp.body?.getReader();
    if (!reader) {
        return (await resp.text()).slice(0, maxBytes);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done || !value) {
                break;
            }
            const remain = maxBytes - total;
            if (value.byteLength <= remain) {
                chunks.push(value);
                total += value.byteLength;
            } else {
                chunks.push(value.slice(0, remain));
                total += remain;
                break;
            }
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // ignore
        }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(merged);
}

/**
 * 轻量抓取页面 meta；失败返回 source:'none'（不抛错）。
 */
export async function fetchPageMeta(
    url: string,
    options?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<PageMeta> {
    if (!url?.trim()) {
        return { source: 'none' };
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { source: 'none' };
        }
    } catch {
        return { source: 'none' };
    }

    const timeoutMs = options?.timeoutMs ?? META_FETCH_TIMEOUT_MS;
    const maxBytes = options?.maxBytes ?? META_HTML_MAX_BYTES;
    const fetchFn = options?.fetchImpl ?? fetch;

    try {
        const resp = await fetchFn(parsed.toString(), {
            method: 'GET',
            redirect: 'follow',
            headers: {
                Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorkersMeta/1.0)',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!resp.ok) {
            return { source: 'none' };
        }
        if (isRejectedContentType(resp.headers.get('content-type'))) {
            return { source: 'none' };
        }

        const html = await readHtmlPrefix(resp, maxBytes);
        return parsePageMetaFromHtml(html);
    } catch {
        return { source: 'none' };
    }
}
