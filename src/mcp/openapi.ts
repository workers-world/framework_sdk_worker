import type { OpenApiDoc } from './types.js';

/** 从 Service Binding 拉取上游 /openapi.json；失败返回空 paths */
export async function fetchUpstreamOpenApi(
    fetcher: Fetcher | undefined,
    baseUrl: string,
): Promise<OpenApiDoc> {
    if (!fetcher) {
        return { openapi: '3.1.0', info: { title: baseUrl, version: '0' }, paths: {} };
    }
    try {
        const resp = await fetcher.fetch(`${baseUrl}/openapi.json`);
        if (!resp.ok) {
            console.warn(`openapi fetch ${baseUrl} HTTP ${resp.status}`);
            return { openapi: '3.1.0', info: { title: baseUrl, version: '0' }, paths: {} };
        }
        return (await resp.json()) as OpenApiDoc;
    } catch (e: unknown) {
        console.warn(`openapi fetch ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
        return { openapi: '3.1.0', info: { title: baseUrl, version: '0' }, paths: {} };
    }
}

/**
 * 合并多份 OpenAPI；同名 path 靠后者覆盖，冲突时告警。
 * info/servers/tags 由调用方按注册表填充。
 */
export function mergeOpenApiDocs(docs: Array<{ name: string; doc: OpenApiDoc }>): OpenApiDoc {
    const mergedPaths: Record<string, unknown> = {};
    const mergedComponents: Record<string, unknown> = {};
    for (const { name, doc } of docs) {
        for (const path of Object.keys(doc.paths ?? {})) {
            if (path in mergedPaths) {
                console.warn(`openapi path 冲突: ${path} 被 ${name} 覆盖`);
            }
        }
        Object.assign(mergedPaths, doc.paths ?? {});
        Object.assign(mergedComponents, doc.components ?? {});
    }
    return {
        openapi: '3.1.0',
        info: { title: 'merged', version: '0.0.1' },
        paths: mergedPaths,
        components: mergedComponents,
    };
}
