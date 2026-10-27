/** 上游 OpenAPI 文档（合并/兜底共用） */
export type OpenApiDoc = {
    openapi?: string;
    info?: { title?: string; version?: string; description?: string };
    paths?: Record<string, unknown>;
    components?: Record<string, unknown>;
    servers?: Array<{ url: string; description?: string }>;
    tags?: Array<{ name: string; description?: string }>;
    [key: string]: unknown;
};

/** Code Mode execute 的请求描述 */
export type ApiRequestOptions = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    contentType?: string;
    rawBody?: boolean;
};

/**
 * 服务注册表条目：path 前缀 → Service Binding 路由与鉴权注入。
 * 每个 MCP server 实例用自己的 entries 表与 allowedMethods 组合出权限范围。
 */
export interface McpServiceEntry {
    /** 下游 worker 名（日志用） */
    worker: string;
    /** env 中的 Service Binding key */
    svcKey: string;
    /** env 中的 token key（下游 worker 鉴权） */
    tokenKey: string;
    /** Service Binding 虚拟 host（URL 约定，实际路由到绑定 worker） */
    baseUrl: string;
    /** path 前缀白名单（execute 请求按此前缀路由） */
    matchPrefixes: string[];
    /** OpenAPI tag（可选） */
    tag?: string;
    /** 服务说明（可选，合并进 OpenAPI info，帮助 LLM 选择服务） */
    description?: string;
    /** 响应裁剪钩子（如 /v1/events 字段裁剪，避免 codemode 截断） */
    transformResponse?: (path: string, parsed: unknown) => unknown;
    /** 上游 fetch 超时 ms（缺省用 router 默认值） */
    timeoutMs?: number;
}

/** Agents SDK 的 MCP host 结构（structural typing，避免直接依赖 agents SDK 类型） */
export type McpHost = {
    addMcpServer: (
        name: string,
        binding: DurableObjectNamespace,
    ) => Promise<{ id: string; state: string }>;
    mcp: {
        getAITools: () => Record<string, unknown>;
        listServers?: () => Array<{ name?: string; serverName?: string; state?: string }>;
    };
};
