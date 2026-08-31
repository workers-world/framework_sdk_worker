/**
 * env.AI 直连统一封装：给保留 Workers AI binding 的 Agent / tool-loop 场景
 * （orchestrator / market-qa / config-agent）提供与 ai/client 相同的
 * 超时与 {ok:false} 错误契约，并默认注入 AI Gateway 观测配置。
 * 说明：超时为放弃等待（abandon），ai.run 本身不可 abort，上游调用与计费可能继续；
 * Neuron 配额预检请按需配合 checkNeuronQuota（需 SVC_LLM_GATEWAY）。
 */
import { withTimeout } from '../async/with-timeout.js';
import { type AiGatewayConfig, callAiModel } from './gateway.js';

export type { AiGatewayConfig } from './gateway.js';

/** Workers AI chat/text 直连默认超时（ai.run 不可 abort，超时仅放弃等待） */
const DEFAULT_AI_DIRECT_TIMEOUT_MS = 60_000;

export interface AiDirectChatMessage {
    role: string;
    content: string;
}

export interface AiDirectChatParams {
    model: string;
    messages: AiDirectChatMessage[];
    temperature?: number;
    max_tokens?: number;
}

export interface AiDirectChatResult {
    ok: boolean;
    content?: string;
    error?: string;
    raw?: unknown;
}

export interface AiDirectOptions {
    /** AI Gateway 配置；缺省用 default gateway（观测/计费注入） */
    gateway?: AiGatewayConfig;
    /** 放弃等待的超时 ms（默认 60s） */
    timeoutMs?: number;
}

function clampTemperature(value: number | undefined): number | undefined {
    if (value == null || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.min(1, Math.max(0, value));
}

/** 兼容 Workers AI 原生 {response}、OpenAI 形状 {choices} 与网关 {result} 包装 */
function extractDirectChatContent(raw: unknown): string | undefined {
    if (typeof raw === 'string') {
        return raw.trim() || undefined;
    }
    if (raw == null || typeof raw !== 'object') {
        return undefined;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.response === 'string' && record.response.trim()) {
        return record.response.trim();
    }
    if (Array.isArray(record.choices) && record.choices.length > 0) {
        const first = record.choices[0] as { message?: { content?: unknown } } | undefined;
        const content = first?.message?.content;
        if (typeof content === 'string' && content.trim()) {
            return content.trim();
        }
    }
    if (record.result != null && typeof record.result === 'object') {
        const nested = (record.result as Record<string, unknown>).response;
        if (typeof nested === 'string' && nested.trim()) {
            return nested.trim();
        }
    }
    return undefined;
}

/**
 * env.AI 直连 chat：统一超时与 {ok:false} 契约，不抛裸异常。
 * inputs 仅接受 messages/temperature/max_tokens；reasoning 等模型行为由调用方处理。
 */
export async function runChatDirect(
    ai: Ai | undefined,
    params: AiDirectChatParams,
    options?: AiDirectOptions,
): Promise<AiDirectChatResult> {
    if (!ai) {
        return { ok: false, error: 'AI binding not configured' };
    }
    if (!params.messages?.length) {
        return { ok: false, error: 'messages 不能为空' };
    }

    const inputs: Record<string, unknown> = { messages: params.messages };
    const temperature = clampTemperature(params.temperature);
    if (temperature != null) {
        inputs.temperature = temperature;
    }
    if (params.max_tokens != null && params.max_tokens > 0) {
        inputs.max_tokens = Math.floor(params.max_tokens);
    }

    try {
        const raw = await withTimeout(
            Promise.resolve(callAiModel(ai, params.model, inputs, options?.gateway)),
            options?.timeoutMs ?? DEFAULT_AI_DIRECT_TIMEOUT_MS,
            'ai.direct chat',
        );
        const content = extractDirectChatContent(raw);
        if (!content) {
            return { ok: false, error: 'AI 返回空内容', raw };
        }
        return { ok: true, content, raw };
    } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
