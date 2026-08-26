/**
 * MCP execute 响应裁剪：压缩 events/digests/worldview 体积，避免 codemode truncateResponse 截断。
 * 供 mcp-registry-worker 等 MCP host 在 registry 条目上挂 transformResponse。
 */

/** 问答用摘要截断长度 */
const AI_SUMMARY_MAX = 200;

/** Unix 秒 → YYYY-MM-DD，供 LLM 直接引用日期 */
function formatEventDate(createdAt: unknown): string | undefined {
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
        return undefined;
    }
    return new Date(createdAt * 1000).toISOString().slice(0, 10);
}

/**
 * 裁剪事件字段：只留问答需要的可读字段，aiSummary 截断到 200。
 * createdAt（Unix 秒）转为 date 字符串，避免模型向用户复述时间戳。
 */
export function trimEventForQa(e: Record<string, unknown>): Record<string, unknown> {
    const ai = typeof e.aiSummary === 'string' ? e.aiSummary : '';
    const out: Record<string, unknown> = {
        title: e.title,
        category: e.category,
        importance: e.importance,
        marketRegion: e.marketRegion,
        aiSummary: ai.length > AI_SUMMARY_MAX ? `${ai.slice(0, AI_SUMMARY_MAX)}…` : ai,
    };
    const date = formatEventDate(e.createdAt);
    if (date) {
        out.date = date;
    }
    return out;
}

/** 对 /v1/events 列表响应裁剪 items；其他 path 原样返回 */
export function maybeTrimEventsResponse(path: string, parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') {
        return parsed;
    }
    const cleanPath = path.split('?')[0] || path;
    if (cleanPath !== '/v1/events') {
        return parsed;
    }
    const obj = parsed as { items?: unknown };
    if (!Array.isArray(obj.items)) {
        return parsed;
    }
    return {
        ok: (obj as { ok?: unknown }).ok,
        items: obj.items.map((item) =>
            item && typeof item === 'object'
                ? trimEventForQa(item as Record<string, unknown>)
                : item,
        ),
    };
}

/**
 * 裁剪摘要记录字段：只留问答需要的可读字段，summary 截断到 200。
 * createdAt 为上海 ISO，取前 10 位日期。
 */
export function trimDigestForQa(d: Record<string, unknown>): Record<string, unknown> {
    const summary = typeof d.summary === 'string' ? d.summary : '';
    const out: Record<string, unknown> = {
        ruleId: d.ruleId,
        title: d.title,
        summaryKind: d.summaryKind,
        summary: summary.length > AI_SUMMARY_MAX ? `${summary.slice(0, AI_SUMMARY_MAX)}…` : summary,
    };
    if (typeof d.url === 'string' && d.url) {
        out.url = d.url;
    }
    if (d.fallback === true) {
        out.fallback = true;
    }
    const created = typeof d.createdAt === 'string' ? d.createdAt.slice(0, 10) : '';
    if (created) {
        out.date = created;
    }
    return out;
}

/** 对 /v1/digests 列表响应裁剪 items；其他 path 原样返回 */
export function maybeTrimDigestsResponse(path: string, parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') {
        return parsed;
    }
    const cleanPath = path.split('?')[0] || path;
    if (cleanPath !== '/v1/digests') {
        return parsed;
    }
    const obj = parsed as { items?: unknown };
    if (!Array.isArray(obj.items)) {
        return parsed;
    }
    return {
        ok: (obj as { ok?: unknown }).ok,
        items: obj.items.map((item) =>
            item && typeof item === 'object'
                ? trimDigestForQa(item as Record<string, unknown>)
                : item,
        ),
    };
}

/** 裁剪世界观主题：只留问答需要的可读字段 */
export function trimThemeForQa(t: Record<string, unknown>): Record<string, unknown> {
    const thesis = typeof t.thesis === 'string' ? t.thesis : '';
    return {
        topic: t.topic,
        stance: t.stance,
        confidence: t.confidence,
        thesis: thesis.length > AI_SUMMARY_MAX ? `${thesis.slice(0, AI_SUMMARY_MAX)}…` : thesis,
        symbolsTouched: Array.isArray(t.symbolsTouched) ? t.symbolsTouched.slice(0, 8) : [],
    };
}

/** 对 /v1/worldview 响应裁剪 themes；单主题详情裁剪 theme */
export function maybeTrimWorldviewResponse(path: string, parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') {
        return parsed;
    }
    const cleanPath = path.split('?')[0] || path;
    if (cleanPath === '/v1/worldview') {
        const obj = parsed as { worldview?: { themes?: unknown } };
        const themes = obj.worldview?.themes;
        if (!Array.isArray(themes)) {
            return parsed;
        }
        return {
            ok: (obj as { ok?: unknown }).ok,
            worldview: {
                version: (obj.worldview as { version?: unknown } | undefined)?.version,
                themes: themes.map((item) =>
                    item && typeof item === 'object'
                        ? trimThemeForQa(item as Record<string, unknown>)
                        : item,
                ),
            },
        };
    }
    const themeDetail = cleanPath.match(/^\/v1\/worldview\/themes\/[^/]+$/);
    if (themeDetail) {
        const obj = parsed as { theme?: unknown };
        if (!obj.theme || typeof obj.theme !== 'object') {
            return parsed;
        }
        return {
            ok: (obj as { ok?: unknown }).ok,
            theme: trimThemeForQa(obj.theme as Record<string, unknown>),
        };
    }
    return parsed;
}
