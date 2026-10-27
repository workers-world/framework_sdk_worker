export interface AiGatewayConfig {
    gatewayId?: string;
    authToken?: string;
    byokAlias?: string;
}

/** 平台 AiOptions / GatewayOptions 已有能力，透传不另造超时或关联体系 */
export interface AiRunOptions {
    signal?: AbortSignal;
    tags?: string[];
    requestTimeoutMs?: number;
    eventId?: string;
    metadata?: Record<string, string | number | boolean | null | bigint>;
}

export function resolveGatewayId(gatewayId?: string): string {
    const id = gatewayId?.trim();
    return id || 'default';
}

export function buildAiGatewayConfig(env: {
    AI_GATEWAY_ID?: string;
    AIG_AUTH_TOKEN?: string;
    AIG_BYOK_ALIAS?: string;
}): AiGatewayConfig {
    return {
        gatewayId: env.AI_GATEWAY_ID,
        authToken: env.AIG_AUTH_TOKEN,
        byokAlias: env.AIG_BYOK_ALIAS,
    };
}

export function isPrunaModel(model: string): boolean {
    return model.startsWith('pruna/');
}

function isReadableStream(value: unknown): value is ReadableStream {
    return value instanceof ReadableStream;
}

function isFormData(value: unknown): value is FormData {
    return value instanceof FormData;
}

function valueUsesReadableStream(value: unknown): boolean {
    if (isReadableStream(value) || isFormData(value)) {
        return true;
    }
    if (value && typeof value === 'object' && 'body' in value) {
        const body = (value as { body?: unknown }).body;
        return isReadableStream(body) || isFormData(body);
    }
    return false;
}

export function inputsUseReadableStream(inputs: Record<string, unknown>): boolean {
    return Object.values(inputs).some(valueUsesReadableStream);
}

export function inputsUseChatMessages(inputs: Record<string, unknown>): boolean {
    const messages = inputs.messages;
    return Array.isArray(messages) && messages.length > 0;
}

export function shouldUseAiGateway(model: string, inputs: Record<string, unknown>): boolean {
    if (inputsUseReadableStream(inputs)) {
        return false;
    }
    if (isPrunaModel(model)) {
        return true;
    }
    if (model.startsWith('@cf/')) {
        return inputsUseChatMessages(inputs);
    }
    return true;
}

function buildGatewayExtraHeaders(config?: AiGatewayConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = config?.authToken?.trim();
    if (token) {
        headers['cf-aig-authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }
    const alias = config?.byokAlias?.trim();
    if (alias) {
        headers['cf-aig-byok-alias'] = alias;
    }
    return headers;
}

function applyRunExtras(
    options: Record<string, unknown>,
    extras?: AiRunOptions,
): Record<string, unknown> {
    if (!extras) {
        return options;
    }
    if (extras.tags && extras.tags.length > 0) {
        options.tags = extras.tags.slice(0, 5);
    }
    if (extras.signal) {
        options.signal = extras.signal;
    }
    const gateway = (options.gateway ?? {}) as Record<string, unknown>;
    if (extras.requestTimeoutMs != null && extras.requestTimeoutMs > 0) {
        gateway.requestTimeoutMs = extras.requestTimeoutMs;
    }
    if (extras.eventId?.trim()) {
        gateway.eventId = extras.eventId.trim();
    }
    if (extras.metadata) {
        gateway.metadata = extras.metadata;
    }
    if (Object.keys(gateway).length > 0) {
        options.gateway = gateway;
    }
    return options;
}

function buildExtraHeadersOnly(config?: AiGatewayConfig, extras?: AiRunOptions) {
    const options: Record<string, unknown> = {};
    const headers = buildGatewayExtraHeaders(config);
    if (Object.keys(headers).length > 0) {
        options.extraHeaders = headers;
    }
    return applyRunExtras(options, extras);
}

export function aiGatewayRunOptions(config?: AiGatewayConfig, extras?: AiRunOptions) {
    const options: Record<string, unknown> = {
        gateway: { id: resolveGatewayId(config?.gatewayId) },
    };
    const headers = buildGatewayExtraHeaders(config);
    if (Object.keys(headers).length > 0) {
        options.extraHeaders = headers;
    }
    return applyRunExtras(options, extras);
}

export async function callAiModel(
    ai: Ai,
    model: string,
    inputs: Record<string, unknown>,
    config?: AiGatewayConfig,
    extras?: AiRunOptions,
): Promise<unknown> {
    const options = shouldUseAiGateway(model, inputs)
        ? aiGatewayRunOptions(config, extras)
        : buildExtraHeadersOnly(config, extras);

    // Ai.run 的静态签名把 model 限定为 keyof AiModels（Workers AI 目录）；
    // 本函数按设计接受任意 provider 的动态模型名/入参（含 gateway 代理场景），
    // 在此单一类型边界收口，避免散布 as any。
    // 必须经 binding 对象调用 run()：detached 引用会丢失 this，运行时报
    // "Cannot set properties of undefined (setting '#options')"。
    const aiBinding = ai as unknown as {
        run(model: string, inputs: Record<string, unknown>, options?: unknown): Promise<unknown>;
    };
    return aiBinding.run(model, inputs, options);
}
