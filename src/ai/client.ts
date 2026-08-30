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

        if (!resp.ok) {
            return {
                ok: false,
                status: resp.status,
                error: data.error || data.detail || resp.statusText || `HTTP ${resp.status}`,
                raw: data,
            };
        }

        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return { ok: false, status: resp.status, error: 'LLM 返回空内容', raw: data };
        }

        return { ok: true, status: resp.status, content, raw: data };
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
