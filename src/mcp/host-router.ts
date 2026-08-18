import {resolveSecret, type SecretLike} from '../secrets/resolve.js';
import type {ApiRequestOptions, McpServiceEntry} from './types.js';

/** 默认上游超时（LLM 类长调用由 entry.timeoutMs 覆盖） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 按 path 前缀匹配注册的服务；无匹配返回 null（靠前的条目先匹配） */
export function matchEntry(entries: McpServiceEntry[], path: string): McpServiceEntry | null {
    const p = path.split('?')[0] || path;
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
    /** 放行的方法集合；缺省放行全部（GET/HEAD/POST/PUT/PATCH/DELETE） */
    allowedMethods?: string[];
    /** 未放行方法时的提示（默认文案面向只读实例） */
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
    const allowed = new Set(
        opts.allowedMethods ?? ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    );
    const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const methodDeniedMessage = opts.methodDeniedMessage ?? '不允许该方法';

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
            return {error: 'method_not_allowed', message: msg};
        }

        const envRecord = env as Record<string, unknown>;
        const fetcher = envRecord[entry.svcKey] as Fetcher | undefined;
        if (!fetcher) {
            return {error: 'svc_missing', message: `${entry.svcKey} 未配置`};
        }
        const token = await resolveSecret(envRecord[entry.tokenKey] as SecretLike | undefined);
        const url = buildUrl(entry.baseUrl, options.path, options.query);

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
            return {error: 'fetch_failed', message: `${entry.worker} 调用失败: ${msg}`};
        }

        const text = await resp.text();
        try {
            const parsed = JSON.parse(text);
            return entry.transformResponse ? entry.transformResponse(options.path, parsed) : parsed;
        } catch {
            return {status: resp.status, body: text.slice(0, 2000)};
        }
    };
}
