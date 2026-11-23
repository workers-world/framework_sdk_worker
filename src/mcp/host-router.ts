import { resolveSecret, type SecretLike } from '../secrets/resolve.js';
import type { ApiRequestOptions, McpServiceEntry } from './types.js';

/** 默认上游超时（LLM 类长调用由 entry.timeoutMs 覆盖） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 归一化路径：解析 . / .. 段，防止 /v1/x/../admin 形式穿越前缀白名单 */
function normalizePath(p: string): string {
    const [pathname, search] = p.split('?');
    const segments: string[] = [];
    for (const seg of pathname.split('/')) {
        if (!seg || seg === '.') {
            continue;
        }
        if (seg === '..') {
            segments.pop();
            continue;
        }
        segments.push(seg);
    }
    const normalized = `/${segments.join('/')}`;
    return search ? `${normalized}?${search}` : normalized;
}

/** 按 path 前缀匹配注册的服务；无匹配返回 null（靠前的条目先匹配） */
export function matchEntry(entries: McpServiceEntry[], path: string): McpServiceEntry | null {
    const p = normalizePath(path).split('?')[0] || normalizePath(path);
    for (const entry of entries) {
        if (entry.matchPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
            return entry;
        }
    }
    return null;
}

function buildUrl(base: string, path: string, query?: ApiRequestOptions['query']): string {
    const url = new URL(
        path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`,
    );
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined) {
                continue;
            }
            url.searchParams.set(k, String(v));
        }
    }
    return url.toString();
}

export interface HostRouterOptions {
    /**
     * 放行的方法集合；缺省仅放行 GET/HEAD/POST（MCP tool call 走 POST，不能砍）。
     * PUT/PATCH/DELETE 等写方法须显式 opt-in——同一默认值要同时服务只读实例与
     * tool-call 实例，故默认取交集而不是自称「只读」。
     */
    allowedMethods?: string[];
    /** 未放行方法时的提示（缺省文案会点名默认只放行 GET/HEAD/POST） */
    methodDeniedMessage?: string | ((method: string) => string);
    /** 兜底上游超时 ms */
    defaultTimeoutMs?: number;
}

/**
 * 构造 OpenAPI execute 请求回调：按 entry 前缀路由到 Service Binding，注入 Bearer。
 * 鉴权留在 host（不进入 Code Mode sandbox）；下游 worker 自身再校验一次。
 * 每个实例用 entries + allowedMethods 组合出最小权限范围。
 */
export function createHostRouter(
    entries: McpServiceEntry[],
    opts: HostRouterOptions = {},
): (env: unknown, options: ApiRequestOptions) => Promise<unknown> {
    const allowed = new Set(opts.allowedMethods ?? ['GET', 'HEAD', 'POST']);
    const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    // 默认文案动态生成并点出方法，与默认放行集合保持一致
    const methodDeniedMessage =
        opts.methodDeniedMessage ??
        ((method: string) =>
            `不允许该方法 ${method}：默认仅放行 GET/HEAD/POST（PUT/PATCH/DELETE 须在 allowedMethods 显式放行）`);

    return async (env, options) => {
        const entry = matchEntry(entries, options.path);
        if (!entry) {
            return {
                error: 'path_not_allowed',
                message: `不允许访问 path: ${options.path}（仅注册表白名单内的前缀）`,
            };
        }
        const method = options.method.toUpperCase();
        if (!allowed.has(method)) {
            const msg =
                typeof methodDeniedMessage === 'function'
                    ? methodDeniedMessage(method)
                    : methodDeniedMessage;
            return { error: 'method_not_allowed', message: msg };
        }

        const envRecord = env as Record<string, unknown>;
        const fetcher = envRecord[entry.svcKey] as Fetcher | undefined;
        if (!fetcher) {
            return { error: 'svc_missing', message: `${entry.svcKey} 未配置` };
        }
        const token = await resolveSecret(envRecord[entry.tokenKey] as SecretLike | undefined);
        if (!token) {
            // 空 Bearer 在下游必被 401；这里显式失败，避免 LLM 侧把 401 误判为业务错误
            return { error: 'token_missing', message: `${entry.tokenKey} 未配置` };
        }
        const path = normalizePath(options.path);
        const url = buildUrl(entry.baseUrl, path, options.query);

        // HEAD 与 GET 同语义：下游无 HEAD 特化实现，按 GET 取回体
        const execMethod = method === 'HEAD' ? 'GET' : method;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${token ?? ''}`,
            Accept: 'application/json',
        };

        let resp: Response;
        try {
            if (execMethod === 'GET') {
                resp = await fetcher.fetch(url, {
                    method: 'GET',
                    headers,
                    signal: AbortSignal.timeout(entry.timeoutMs ?? defaultTimeoutMs),
                });
            } else {
                if (options.body !== undefined) {
                    headers['Content-Type'] = options.contentType ?? 'application/json';
                }
                resp = await fetcher.fetch(url, {
                    method: execMethod,
                    headers,
                    body:
                        options.body === undefined
                            ? undefined
                            : typeof options.body === 'string'
                              ? options.body
                              : JSON.stringify(options.body),
                    signal: AbortSignal.timeout(entry.timeoutMs ?? defaultTimeoutMs),
                });
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`mcp execute ${entry.worker} ${method} ${options.path}: ${msg}`);
            return { error: 'fetch_failed', message: `${entry.worker} 调用失败: ${msg}` };
        }

        const text = await resp.text();
        try {
            const parsed = JSON.parse(text);
            return entry.transformResponse ? entry.transformResponse(options.path, parsed) : parsed;
        } catch {
            return { status: resp.status, body: text.slice(0, 2000) };
        }
    };
}
