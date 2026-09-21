import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

/** LLM 调用超时：gateway 挂起时避免调用方占满 isolate 墙钟上限 */
const LLM_CALL_TIMEOUT_MS = 25_000;

export interface LlmChatMessage {
    role: string;
    content: string;
}

export interface LlmChatParams {
    model: string;
    messages: LlmChatMessage[];
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: string };
    /** 与 notify/quality incident 同源，便于 gateway 日志关联 */
    dedupKey?: string;
    /** 跨 Worker 追踪；缺省时调用方可传 D1 tech_trace_id */
    traceId?: string;
    /**
     * 调用方标识，约定 `<worker>:<服务场景>`（如 `advisor-worker:advice-cluster`）。
     * 以 X-Caller 头送达网关，进入 AE quality_slo blob 与失败事件 detail，供按调用方统计。
     */
    caller?: string;
}

export interface LlmChatResponse {
    ok: boolean;
    status: number;
    content?: string;
    error?: string;
    raw?: unknown;
    /** CF Workers Observability（cf-ray） */
    cfRequestId?: string;
}

export interface NeuronQuotaSnapshot {
    ok?: boolean;
    checked: boolean;
    exceeded: boolean;
    used: number;
    limit: number;
    remaining: number;
    error?: string;
    latched?: boolean;
}

export interface LlmGatewayEnv {
    SVC_LLM_GATEWAY?: Fetcher;
    LLM_GATEWAY_AUTH_TOKEN?: SecretLike;
}

export interface LlmModelLimits {
    id: string;
    contextWindowTokens?: number;
    maxOutputTokens?: number;
    transportMaxBytes?: number;
    raw?: Record<string, unknown>;
}

const MODEL_LIMITS_CACHE_TTL_MS = 60_000;
const modelLimitsCache = new Map<string, { at: number; limits: LlmModelLimits | null }>();

function finitePositive(value: unknown): number | undefined {
    const n =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function propertyValue(row: Record<string, unknown>, id: string): unknown {
    const props = row.properties;
    if (!Array.isArray(props)) {
        return undefined;
    }
    const hit = props.find(
        (p) => p && typeof p === 'object' && (p as { property_id?: string }).property_id === id,
    ) as { value?: unknown } | undefined;
    return hit?.value;
}

/** 从门户 /v1/models/:id 行读取窗口与传输上限（不执法、不维护 overlay） */
export function limitsFromPortalRow(row: Record<string, unknown>): LlmModelLimits {
    const id = String(row.id ?? row.model_id ?? '');
    return {
        id,
        contextWindowTokens:
            finitePositive(row.context_window) ??
            finitePositive(row.context_length) ??
            finitePositive(propertyValue(row, 'context_window')),
        maxOutputTokens:
            finitePositive(row.max_output_tokens) ??
            finitePositive(propertyValue(row, 'max_output_tokens')),
        transportMaxBytes: finitePositive(row.transport_max_bytes),
        raw: row,
    };
}

/** 与门户 ASCII 估计互逆：约 4 字 1 token */
const BYTES_PER_ESTIMATED_TOKEN = 4;
const PROMPT_TOKEN_RESERVE = 256;

export function promptBudgetBytes(
    limits: LlmModelLimits,
    reservedOutputTokens: number,
    systemBytes: number,
): number | undefined {
    const out =
        Number.isFinite(reservedOutputTokens) && reservedOutputTokens > 0
            ? Math.floor(reservedOutputTokens)
            : 0;
    const tokenBudgetBytes =
        limits.contextWindowTokens != null
            ? Math.max(0, limits.contextWindowTokens - out - PROMPT_TOKEN_RESERVE) *
              BYTES_PER_ESTIMATED_TOKEN
            : undefined;
    const transportBudget =
        limits.transportMaxBytes != null
            ? Math.max(0, limits.transportMaxBytes - Math.max(0, systemBytes))
            : undefined;
    if (tokenBudgetBytes == null && transportBudget == null) {
        return undefined;
    }
    return Math.min(
        tokenBudgetBytes ?? Number.POSITIVE_INFINITY,
        transportBudget ?? Number.POSITIVE_INFINITY,
    );
}

/** 测试用：清空 isolate 内门户 limits 缓存 */
export function resetModelLimitsCache(): void {
    modelLimitsCache.clear();
}

export async function getModelLimits(
    env: LlmGatewayEnv,
    model: string,
): Promise<LlmModelLimits | null> {
    const id = model.trim();
    if (!id) {
        return null;
    }
    const cached = modelLimitsCache.get(id);
    if (cached && Date.now() - cached.at < MODEL_LIMITS_CACHE_TTL_MS) {
        return cached.limits;
    }
    if (!env.SVC_LLM_GATEWAY) {
        return null;
    }
    let headers: Record<string, string>;
    try {
        headers = await authHeader(env.LLM_GATEWAY_AUTH_TOKEN);
    } catch {
        return null;
    }
    try {
        const resp = await env.SVC_LLM_GATEWAY.fetch(
            `https://llm/v1/models/${encodeURIComponent(id)}`,
            { headers, signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS) },
        );
        if (!resp.ok) {
            modelLimitsCache.set(id, { at: Date.now(), limits: null });
            return null;
        }
        const row = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
        const limits = limitsFromPortalRow(row);
        modelLimitsCache.set(id, { at: Date.now(), limits });
        return limits;
    } catch {
        return null;
    }
}

async function authHeader(token: SecretLike | undefined): Promise<Record<string, string>> {
    const resolved = await resolveSecret(token);
    if (!resolved) {
        throw new Error('LLM_GATEWAY_AUTH_TOKEN 未配置');
    }
    return { Authorization: `Bearer ${resolved}` };
}

export async function chatGeneral(
    env: LlmGatewayEnv,
    params: LlmChatParams,
): Promise<LlmChatResponse> {
    return chatAt(env, 'https://llm/v1/chat/general', params);
}

export async function chatInvest(
    env: LlmGatewayEnv,
    params: LlmChatParams,
): Promise<LlmChatResponse> {
    return chatAt(env, 'https://llm/v1/chat/invest', params);
}

async function chatAt(
    env: LlmGatewayEnv,
    url: string,
    params: LlmChatParams,
): Promise<LlmChatResponse> {
    if (!env.SVC_LLM_GATEWAY) {
        return { ok: false, status: 0, error: 'SVC_LLM_GATEWAY 未配置' };
    }

    let headers: Record<string, string>;
    try {
        headers = {
            ...(await authHeader(env.LLM_GATEWAY_AUTH_TOKEN)),
            'Content-Type': 'application/json',
        };
        if (params.dedupKey) {
            headers['X-Dedup-Key'] = params.dedupKey;
        }
        if (params.traceId) {
            headers['X-Trace-Id'] = params.traceId;
        }
        if (params.caller) {
            headers['X-Caller'] = params.caller;
        }
    } catch (e: unknown) {
        return {
            ok: false,
            status: 0,
            error: e instanceof Error ? e.message : String(e),
        };
    }

    try {
        const resp = await env.SVC_LLM_GATEWAY.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: params.model,
                messages: params.messages,
                temperature: params.temperature,
                max_tokens: params.max_tokens,
                response_format: params.response_format,
                dedupKey: params.dedupKey,
                traceId: params.traceId,
            }),
            signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
        });

        const data = (await resp.json().catch(() => ({}))) as {
            choices?: Array<{ message?: { content?: string } }>;
            error?: string;
            detail?: string;
        };

        const cfRequestId = resp.headers.get('cf-ray')?.trim() || undefined;

        if (!resp.ok) {
            const extra =
                resp.status === 413 &&
                (data as { estimated?: unknown; limit?: unknown }).estimated != null
                    ? ` estimated=${(data as { estimated?: unknown }).estimated} limit=${(data as { limit?: unknown }).limit}`
                    : '';
            return {
                ok: false,
                status: resp.status,
                error:
                    (data.error || data.detail || resp.statusText || `HTTP ${resp.status}`) + extra,
                raw: data,
                cfRequestId,
            };
        }

        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return {
                ok: false,
                status: resp.status,
                error: 'LLM 返回空内容',
                raw: data,
                cfRequestId,
            };
        }

        return { ok: true, status: resp.status, content, raw: data, cfRequestId };
    } catch (e: unknown) {
        // 契约统一：超时/网络错误与 HTTP 错误一样返回 {ok:false}，不抛裸异常
        return {
            ok: false,
            status: 0,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

export async function checkNeuronQuota(
    env: LlmGatewayEnv,
    fallbackLimit = 10_000,
): Promise<NeuronQuotaSnapshot> {
    const unavailable = (error?: string): NeuronQuotaSnapshot => ({
        ok: false,
        checked: false,
        exceeded: false,
        used: 0,
        limit: fallbackLimit,
        remaining: fallbackLimit,
        error,
    });

    if (!env.SVC_LLM_GATEWAY) {
        return unavailable('SVC_LLM_GATEWAY 未配置');
    }

    let auth: Record<string, string>;
    try {
        auth = await authHeader(env.LLM_GATEWAY_AUTH_TOKEN);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return unavailable(msg);
    }

    try {
        const resp = await env.SVC_LLM_GATEWAY.fetch('https://llm/v1/usage/neurons', {
            headers: auth,
            signal: AbortSignal.timeout(LLM_CALL_TIMEOUT_MS),
        });
        const data = (await resp.json()) as Partial<NeuronQuotaSnapshot>;
        if (!resp.ok) {
            return unavailable(data.error || `usage neurons HTTP ${resp.status}`);
        }
        return {
            ok: data.ok !== false,
            checked: data.checked === true,
            exceeded: data.exceeded === true,
            used: data.used ?? 0,
            limit: data.limit ?? fallbackLimit,
            remaining: data.remaining ?? fallbackLimit,
            error: data.error,
            latched: data.latched === true,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return unavailable(msg);
    }
}
