import type {McpServiceEntry, OpenApiDoc} from './types.js';

/**
 * 全平台静态兜底 OpenAPI（上游 /openapi.json 全部不可用时）。
 * 单一事实来源：各 MCP server 按自己的 entries 前缀过滤使用，避免多份手工 spec 漂移。
 */
export const DEFAULT_FALLBACK_SPEC: OpenApiDoc = {
    openapi: '3.1.0',
    info: {
        title: 'fallback',
        version: '0.0.1',
        description: '静态兜底 OpenAPI（上游 /openapi.json 不可用时）',
    },
    paths: {
        '/v1/advice': {
            get: {
                operationId: 'listAdvice',
                tags: ['advice'],
                summary: '列出顾问建议',
                parameters: [
                    {
                        name: 'status',
                        in: 'query',
                        schema: {type: 'string', enum: ['done', 'failed', 'skipped', 'all']},
                    },
                    {
                        name: 'since',
                        in: 'query',
                        description: '起始时间，如 2026-08-04 00:00:00',
                        schema: {type: 'string'},
                    },
                    {name: 'source', in: 'query', schema: {type: 'string'}},
                    {name: 'limit', in: 'query', schema: {type: 'integer', default: 50}},
                    {name: 'offset', in: 'query', schema: {type: 'integer', default: 0}},
                ],
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/events': {
            get: {
                operationId: 'listEvents',
                tags: ['events'],
                summary: '列出投资 RSS 事件',
                parameters: [
                    {
                        name: 'days',
                        in: 'query',
                        description: '回溯天数',
                        schema: {type: 'integer', default: 7},
                    },
                    {
                        name: 'category',
                        in: 'query',
                        schema: {
                            type: 'string',
                            enum: ['price_alert', 'event', 'analysis', 'news'],
                        },
                    },
                    {name: 'minImportance', in: 'query', schema: {type: 'integer'}},
                    {
                        name: 'marketRegion',
                        in: 'query',
                        schema: {
                            type: 'string',
                            enum: ['domestic', 'international', 'global', 'unknown'],
                        },
                    },
                    {
                        name: 'llmStatus',
                        in: 'query',
                        schema: {type: 'string', enum: ['all', 'done', 'pending', 'failed']},
                    },
                    {name: 'feed', in: 'query', schema: {type: 'string'}},
                    {name: 'limit', in: 'query', schema: {type: 'integer', default: 50}},
                    {name: 'offset', in: 'query', schema: {type: 'integer', default: 0}},
                ],
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/events/stats': {
            get: {
                operationId: 'eventStats',
                tags: ['events'],
                summary: '事件统计',
                parameters: [
                    {name: 'days', in: 'query', schema: {type: 'integer', default: 7}},
                ],
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/portfolio': {
            get: {
                operationId: 'getPortfolio',
                tags: ['portfolio'],
                summary: '获取持仓',
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/rules': {
            get: {
                operationId: 'listEmailRules',
                tags: ['email-rule'],
                summary: '列出所有邮件路由规则',
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/content-filters/{scope}/{stage}': {
            get: {
                operationId: 'getContentFilter',
                tags: ['email-rule'],
                summary: '读取 content-filter 配置',
                parameters: [
                    {name: 'scope', in: 'path', required: true, schema: {type: 'string'}},
                    {
                        name: 'stage',
                        in: 'path',
                        required: true,
                        schema: {type: 'string', enum: ['before', 'after']},
                    },
                ],
                responses: {'200': {description: 'ok'}},
            },
            put: {
                operationId: 'putContentFilter',
                tags: ['email-rule'],
                summary: '写入 content-filter 配置（整体覆盖）',
                parameters: [
                    {name: 'scope', in: 'path', required: true, schema: {type: 'string'}},
                    {
                        name: 'stage',
                        in: 'path',
                        required: true,
                        schema: {type: 'string', enum: ['before', 'after']},
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    config: {
                                        type: 'object',
                                        description: 'ContentFilterConfig，含 rules 数组',
                                    },
                                },
                                required: ['config'],
                            },
                        },
                    },
                },
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/digests': {
            get: {
                operationId: 'listDigests',
                tags: ['email-rule'],
                summary: '查询 LLM 摘要索引（关键词/规则/时间区间）',
                parameters: [
                    {
                        name: 'keyword',
                        in: 'query',
                        description: '标题/摘要关键字（LIKE 模糊匹配）',
                        schema: {type: 'string'},
                    },
                    {name: 'ruleId', in: 'query', schema: {type: 'string'}},
                    {
                        name: 'from',
                        in: 'query',
                        description: '起始日期（含），上海时区，格式 YYYY-MM-DD',
                        schema: {type: 'string'},
                    },
                    {
                        name: 'to',
                        in: 'query',
                        description: '结束日期（含），上海时区，格式 YYYY-MM-DD',
                        schema: {type: 'string'},
                    },
                    {
                        name: 'limit',
                        in: 'query',
                        schema: {type: 'integer', default: 50, maximum: 200},
                    },
                    {name: 'offset', in: 'query', schema: {type: 'integer', default: 0}},
                ],
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/log': {
            post: {
                operationId: 'writeMaintenanceLog',
                tags: ['audit-log'],
                summary: '写入一条维护日志',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    ts: {type: 'string'},
                                    actor: {type: 'string'},
                                    worker: {type: 'string'},
                                    service: {type: 'string'},
                                    action: {type: 'string'},
                                    target: {type: 'string'},
                                    tech: {type: 'string'},
                                    before: {type: 'string'},
                                    after: {type: 'string'},
                                    traceId: {type: 'string'},
                                    opId: {type: 'string'},
                                    detail: {type: 'string'},
                                },
                                required: ['actor', 'worker', 'action'],
                            },
                        },
                    },
                },
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/logs': {
            get: {
                operationId: 'queryMaintenanceLogs',
                tags: ['audit-log'],
                summary: '查询维护日志（按 id 倒序）',
                parameters: [
                    {name: 'worker', in: 'query', schema: {type: 'string'}},
                    {name: 'service', in: 'query', schema: {type: 'string'}},
                    {name: 'action', in: 'query', schema: {type: 'string'}},
                    {name: 'limit', in: 'query', schema: {type: 'integer', default: 20}},
                ],
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/id': {
            post: {
                operationId: 'generateId',
                tags: ['counter'],
                summary: '生成顺序 ID',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    prefix: {type: 'string', description: 'ID 前缀（1-4 位）'},
                                },
                                required: ['prefix'],
                            },
                        },
                    },
                },
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/send': {
            post: {
                operationId: 'sendEmail',
                tags: ['notify'],
                summary: '立即发送邮件通知',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    to: {type: 'string'},
                                    subject: {type: 'string'},
                                    body: {type: 'string'},
                                    html: {type: 'string'},
                                    dedupKey: {type: 'string'},
                                },
                                required: ['subject'],
                            },
                        },
                    },
                },
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/usage/neurons': {
            get: {
                operationId: 'getNeuronQuota',
                tags: ['llm'],
                summary: '查询 neuron 配额使用/限制/剩余',
                responses: {'200': {description: 'ok'}},
            },
        },
        '/v1/models': {
            get: {
                operationId: 'listModels',
                tags: ['llm'],
                summary: '列出可用模型',
                responses: {'200': {description: 'ok'}},
            },
        },
    },
};

/** 按 entries 前缀过滤兜底 spec，并生成 servers/tags 元数据 */
export function filterFallbackSpecByEntries(entries: McpServiceEntry[]): OpenApiDoc {
    const paths: Record<string, unknown> = {};
    for (const [path, item] of Object.entries(DEFAULT_FALLBACK_SPEC.paths ?? {})) {
        const matched = entries.some((e) =>
            e.matchPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
        );
        if (matched) {
            paths[path] = item;
        }
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'fallback',
            version: '0.0.1',
            description: '静态兜底 OpenAPI（上游 /openapi.json 不可用时）',
        },
        servers: entries.map((e) => ({
            url: e.baseUrl,
            description: e.description ?? e.worker,
        })),
        tags: entries
            .filter((e) => e.tag)
            .map((e) => ({name: e.tag ?? '', description: e.description ?? ''})),
        paths,
    };
}
