/**
 * 轻量页面 meta 抓取：仅 HTTP + 前 64KB HTML 解析 og/description/title。
 * 上游：email-rule / invest-rss 产品落地页路径。
 * 下游：formatPageMetaSnippet → LLM prompt 正文片段。
 * 不变量：不启 Browser；超时/非 HTML/失败 → source:'none'，不抛致命错误。
 */
import { classifyLinkLandingTier } from '../url.js';

export type PageMetaSource = 'og' | 'meta' | 'title' | 'none';

export interface PageMeta {
    title?: string;
    description?: string;
    siteName?: string;
    source: PageMetaSource;
}

const META_FETCH_TIMEOUT_MS = 8_000;
const META_HTML_MAX_BYTES = 64 * 1024;
const META_FETCH_MAX_REDIRECTS = 5;

const BLOCKED_FETCH_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const DNS_JSON_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_LOOKUP_TIMEOUT_MS = 3_000;

function isIpv4Literal(host: string): boolean {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isIpv6Literal(host: string): boolean {
    return host.includes(':');
}

function isPrivateIpv4Literal(host: string): boolean {
    const parts = host.split('.');
    if (parts.length !== 4) {
        return false;
    }
    if (parts.some((p) => !/^\d{1,3}$/.test(p))) {
        return false;
    }
    const octets = parts.map((p) => Number.parseInt(p, 10));
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127) {
        return true; // 本网段 / 私网 / 环回
    }
    if (a === 169 && b === 254) {
        return true; // link-local
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return true; // 私网
    }
    if (a === 192 && b === 168) {
        return true; // 私网
    }
    if (a === 100 && b >= 64 && b <= 127) {
        return true; // CGNAT
    }
    if (a === 192 && b === 0 && c === 0) {
        return true; // 192.0.0.0/24 IETF 协议保留
    }
    if (a === 198 && (b === 18 || b === 19)) {
        return true; // 198.18.0.0/15 基准测试
    }
    if (a === 192 && b === 0 && c === 2) {
        return true; // TEST-NET-1
    }
    if (a === 198 && b === 51 && c === 100) {
        return true; // TEST-NET-2
    }
    if (a === 203 && b === 0 && c === 113) {
        return true; // TEST-NET-3
    }
    if (a >= 224) {
        return true; // 组播 224/4 + 保留 240/4 + 广播
    }
    return false;
}

/** 解析 IPv4-mapped IPv6 的内嵌 IPv4（dotted-quad 或 hex 对），非映射形式返回 null */
function mappedIpv4FromIpv6(host: string): string | null {
    let rest: string | null = null;
    if (host.startsWith('::ffff:')) {
        rest = host.slice('::ffff:'.length);
    } else {
        // 全展开形式 0:0:0:0:0:ffff:x（可能再带 :: 前导压缩）
        const match = host.match(/^(?:::)?0:0:0:0:0:ffff:(.+)$/);
        if (match) {
            rest = match[1];
        }
    }
    if (!rest) {
        return null;
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(rest)) {
        return rest;
    }
    // ::ffff:7f00:1 十六进制形式（= 127.0.0.1）
    const groups = rest.split(':');
    if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) {
        const hi = Number.parseInt(groups[0], 16);
        const lo = Number.parseInt(groups[1], 16);
        return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
    return null;
}

function isPrivateIpv6Literal(host: string): boolean {
    const normalized = host.toLowerCase();
    if (normalized === '::' || normalized === '::1') {
        return true;
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
        return true;
    }
    if (normalized.startsWith('fe80:')) {
        return true;
    }
    // IPv4-mapped（含 ::ffff:7f00:1 / ::ffff:0a00:0001 十六进制变体与 0:...:ffff:x 全展开形式）
    const mapped = mappedIpv4FromIpv6(normalized);
    if (mapped) {
        return isPrivateIpv4Literal(mapped);
    }
    // 已知限制：NAT64（64:ff9b::/96）等内嵌翻译前缀未覆盖——Workers 出网无 NAT64 网关可走，风险可忽略
    return false;
}

function isPrivateIpLiteral(host: string): boolean {
    return isPrivateIpv4Literal(host) || isPrivateIpv6Literal(host);
}

function normalizeHostname(hostname: string): string {
    let host = hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1);
    }
    return host;
}

interface DnsJsonAnswer {
    name: string;
    type: number;
    TTL: number;
    data: string;
}

interface DnsJsonResponse {
    Status: number;
    Answer?: DnsJsonAnswer[];
}

async function queryDnsRecords(
    hostname: string,
    recordType: 1 | 28,
    fetchFn: typeof fetch,
): Promise<string[]> {
    const url = `${DNS_JSON_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${recordType}`;
    const resp = await fetchFn(url, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
    });
    if (!resp.ok) {
        return [];
    }
    const data = (await resp.json()) as DnsJsonResponse;
    if (data.Status !== 0) {
        return [];
    }
    return (data.Answer ?? [])
        .filter((answer) => answer.type === recordType)
        .map((answer) => answer.data);
}

/**
 * 解析 hostname 并返回可连接的公网地址；私网/无记录/解析失败 → null（fail-closed）。
 * IP 字面量已在 sync 阶段校验，此处直接回传。
 */
export async function resolvePublicFetchAddresses(
    hostname: string,
    fetchFn: typeof fetch = fetch,
): Promise<string[] | null> {
    const normalized = normalizeHostname(hostname);
    if (isIpv4Literal(normalized) || isIpv6Literal(normalized)) {
        return isPrivateIpLiteral(normalized) ? null : [normalized];
    }

    try {
        const [ipv4, ipv6] = await Promise.all([
            queryDnsRecords(normalized, 1, fetchFn),
            queryDnsRecords(normalized, 28, fetchFn),
        ]);
        const addresses = [...ipv4, ...ipv6];
        if (addresses.length === 0) {
            return null;
        }
        if (addresses.some((address) => isPrivateIpLiteral(address))) {
            return null;
        }
        return addresses;
    } catch {
        return null;
    }
}

/** 是否允许对外发起 HTTP(S) 抓取（阻断 loopback / 私网 / link-local / metadata） */
export function isPublicFetchUrl(url: URL): boolean {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }
    if (url.username || url.password) {
        return false;
    }

    const hostname = normalizeHostname(url.hostname);

    if (BLOCKED_FETCH_HOSTNAMES.has(hostname)) {
        return false;
    }
    if (
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
    ) {
        return false;
    }
    if (isPrivateIpLiteral(hostname)) {
        return false;
    }
    return true;
}

/** sync 主机名校验 + DNS 解析目标均为公网（防 rebinding） */
export async function isPublicFetchDestination(
    url: URL,
    fetchFn: typeof fetch = fetch,
): Promise<boolean> {
    if (!isPublicFetchUrl(url)) {
        return false;
    }
    const addresses = await resolvePublicFetchAddresses(url.hostname, fetchFn);
    return addresses !== null && addresses.length > 0;
}

async function fetchWithSafeRedirects(
    initialUrl: URL,
    init: RequestInit,
    fetchFn: typeof fetch,
    maxRedirects = META_FETCH_MAX_REDIRECTS,
): Promise<Response | null> {
    let current = initialUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        if (!isPublicFetchUrl(current)) {
            return null;
        }
        const resolvedAddresses = await resolvePublicFetchAddresses(current.hostname, fetchFn);
        if (!resolvedAddresses || resolvedAddresses.length === 0) {
            return null;
        }
        const resp = await fetchFn(current.toString(), {
            ...init,
            redirect: 'manual',
            // 防 rebinding 双保险：逐跳 DoH 校验（主防线）+ resolveOverride 钉扎。
            // 注意：resolveOverride 传裸 IP 的行为属平台实现细节（官方文档面向 hostname），
            // 即使被运行时忽略，上方的逐跳私网校验仍会阻断重定向到私网。
            cf: { resolveOverride: resolvedAddresses[0] },
        });
        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('location');
            if (!location) {
                return null;
            }
            try {
                current = new URL(location, current);
            } catch {
                return null;
            }
            continue;
        }
        return resp;
    }
    return null;
}

function unescapeHtml(text: string): string {
    return text
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
        })
        .replace(/&amp;/gi, '&');
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

const CREATIVE_CONTENT_META_RE =
    /\b(short\s+story|novella|fiction|memoir|poem|poetry|novelette)\b|written\s+by\b/i;

/** og/meta 是否表明创作类落地页（短篇/散文等），非 SaaS 产品页 */
export function isCreativeContentPageMeta(meta: PageMeta): boolean {
    const blob = [meta.title, meta.description, meta.siteName].filter(Boolean).join(' ');
    return CREATIVE_CONTENT_META_RE.test(blob);
}

/** Tier 2：meta 内容分类（规则；ambiguous slug 探测后用） */
export type PageMetaFetchKind = 'landing' | 'article' | 'unknown';

const ARTICLE_PAGE_META_RE =
    /\b(essay|essays|article|blog\s+post|opinion|analysis|deep\s+dive|published\s+on|min(?:ute)?s?\s+(?:to\s+)?read|research|white\s+paper|case\s+study)\b/i;

const PRODUCT_PAGE_META_RE =
    /\b(free\s+trial|sign\s*up|get\s+started|try\s+(?:it\s+)?free|pricing|download\s+(?:the\s+)?app|saas|software\s+platform|book\s+a\s+demo|request\s+a\s+demo|start\s+your\s+free|product\s+demo|waitlist)\b/i;

/** 基于 og/meta 判定 ambiguous URL 应走落地页 meta 还是全文抓取 */
export function classifyPageMetaForFetch(meta: PageMeta): PageMetaFetchKind {
    if (!hasUsablePageMeta(meta)) {
        return 'unknown';
    }

    const blob = [meta.title, meta.description, meta.siteName].filter(Boolean).join(' ');
    if (ARTICLE_PAGE_META_RE.test(blob)) {
        return 'article';
    }
    if (isCreativeContentPageMeta(meta)) {
        return 'landing';
    }
    if (PRODUCT_PAGE_META_RE.test(blob)) {
        return 'landing';
    }

    const description = meta.description?.trim() ?? '';
    const title = meta.title?.trim() ?? '';
    if (description.length >= 120 && (description.match(/[.!?]/g)?.length ?? 0) >= 2) {
        return 'article';
    }
    if (title.split(/\s+/).filter(Boolean).length >= 5 && !PRODUCT_PAGE_META_RE.test(blob)) {
        return 'article';
    }
    if (title.length > 0 && description.length > 0 && description.length < 140) {
        return 'landing';
    }
    return 'unknown';
}

function stripHtmlToText(html: string): string {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function normalizeVisibleLine(line: string): string | undefined {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    return cleaned || undefined;
}

/** 从落地页 HTML 提取 main/h1/p 可见文案（非全文文章） */
export function extractLandingPageVisibleCopy(html: string): string | undefined {
    if (!html?.trim()) {
        return undefined;
    }

    const chunks: string[] = [];
    const mainRe = /<main\b[^>]*>([\s\S]*?)<\/main>/gi;
    let mainMatch: RegExpExecArray | null = mainRe.exec(html);
    while (mainMatch) {
        const text = stripHtmlToText(mainMatch[1] ?? '');
        if (text) {
            chunks.push(text);
        }
        mainMatch = mainRe.exec(html);
    }

    if (chunks.length === 0) {
        const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
        const bodyHtml = bodyMatch?.[1] ?? html;
        const headingRe = /<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>/gi;
        const paragraphRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
        for (const re of [headingRe, paragraphRe]) {
            let match: RegExpExecArray | null = re.exec(bodyHtml);
            while (match) {
                const text = stripHtmlToText(match[0] ?? '');
                if (text) {
                    chunks.push(text);
                }
                match = re.exec(bodyHtml);
            }
        }
    }

    const lines = chunks
        .join('\n')
        .split('\n')
        .map(normalizeVisibleLine)
        .filter((line): line is string => Boolean(line));

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const key = line.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(line);
    }

    const text = deduped.join('\n').trim();
    return text.length >= 40 ? text : undefined;
}

/** 将 meta 格式化为 LLM 可用的结构化片段 */
export function formatPageMetaSnippet(meta: PageMeta): string {
    return formatProductLandingSnippet(meta);
}

/** 将 meta + 落地页可见文案格式化为 LLM 片段 */
export function formatProductLandingSnippet(meta: PageMeta, visibleCopy?: string): string {
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
    if (isCreativeContentPageMeta(meta)) {
        lines.push('类型：创作推广');
    }
    const trimmedVisible = visibleCopy?.trim();
    if (trimmedVisible) {
        lines.push('', '页面可见文案：', trimmedVisible);
    }
    return lines.join('\n');
}

export interface ProductLandingFetchResult {
    meta: PageMeta;
    snippet: string;
    /** 已抓取的 HTML 前缀，供下游复用避免二次请求 */
    htmlPrefix?: string;
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

async function fetchHtmlPrefix(
    url: string,
    options?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<string | null> {
    if (!url?.trim()) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
        if (!isPublicFetchUrl(parsed)) {
            return null;
        }
    } catch {
        return null;
    }

    const timeoutMs = options?.timeoutMs ?? META_FETCH_TIMEOUT_MS;
    const maxBytes = options?.maxBytes ?? META_HTML_MAX_BYTES;
    const fetchFn = options?.fetchImpl ?? fetch;

    try {
        const resp = await fetchWithSafeRedirects(
            parsed,
            {
                method: 'GET',
                headers: {
                    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (compatible; CloudflareWorkersMeta/1.0)',
                },
                signal: AbortSignal.timeout(timeoutMs),
            },
            fetchFn,
        );

        if (!resp?.ok) {
            return null;
        }
        if (isRejectedContentType(resp.headers.get('content-type'))) {
            return null;
        }

        return await readHtmlPrefix(resp, maxBytes);
    } catch {
        return null;
    }
}

/**
 * 轻量抓取页面 meta；失败返回 source:'none'（不抛错）。
 */
export async function fetchPageMeta(
    url: string,
    options?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<PageMeta> {
    const html = await fetchHtmlPrefix(url, options);
    if (!html) {
        return { source: 'none' };
    }
    return parsePageMetaFromHtml(html);
}

/**
 * 一次 HTTP 抓取落地页 meta + 可见文案，合并为 LLM 片段。
 */
export async function fetchProductLandingSnippet(
    url: string,
    options?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<ProductLandingFetchResult> {
    const html = await fetchHtmlPrefix(url, options);
    if (!html) {
        return { meta: { source: 'none' }, snippet: '' };
    }
    const meta = parsePageMetaFromHtml(html);
    const visibleCopy = extractLandingPageVisibleCopy(html);
    return {
        meta,
        snippet: formatProductLandingSnippet(meta, visibleCopy),
        htmlPrefix: html,
    };
}

export type LandingOrArticleFetchPath = 'landing' | 'landing_failed' | 'article';

export interface LandingOrArticleFetchResult {
    path: LandingOrArticleFetchPath;
    meta: PageMeta;
    snippet: string;
    /** resolve 阶段已抓取的 HTML 前缀；path=article 时可复用解析，避免二次 bare fetch */
    htmlPrefix?: string;
}

/**
 * Tier 0–2 统一编排：高置信 landing 直接 meta 抓；ambiguous 先 meta 再分类；
 * not_landing / meta 判为 article → 走全文抓取路径。
 */
export async function resolveLandingOrArticleFetch(
    url: string,
    options?: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<LandingOrArticleFetchResult> {
    const tier = classifyLinkLandingTier(url);

    if (tier === 'not_landing') {
        return { path: 'article', meta: { source: 'none' }, snippet: '' };
    }

    const landing = await fetchProductLandingSnippet(url, options);
    if (!hasUsablePageMeta(landing.meta)) {
        return tier === 'landing'
            ? { path: 'landing_failed', meta: landing.meta, snippet: '' }
            : {
                  path: 'article',
                  meta: landing.meta,
                  snippet: '',
                  htmlPrefix: landing.htmlPrefix,
              };
    }

    if (tier === 'landing') {
        return {
            path: 'landing',
            meta: landing.meta,
            snippet: landing.snippet,
            htmlPrefix: landing.htmlPrefix,
        };
    }

    const kind = classifyPageMetaForFetch(landing.meta);
    if (kind === 'landing') {
        return {
            path: 'landing',
            meta: landing.meta,
            snippet: landing.snippet,
            htmlPrefix: landing.htmlPrefix,
        };
    }
    if (kind === 'article') {
        return {
            path: 'article',
            meta: landing.meta,
            snippet: '',
            htmlPrefix: landing.htmlPrefix,
        };
    }
    return {
        path: 'article',
        meta: landing.meta,
        snippet: '',
        htmlPrefix: landing.htmlPrefix,
    };
}
