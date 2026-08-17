export interface AiGatewayConfig {
    gatewayId?: string;
    authToken?: string;
    byokAlias?: string;
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

function buildExtraHeadersOnly(config?: AiGatewayConfig) {
    const headers = buildGatewayExtraHeaders(config);
    if (Object.keys(headers).length === 0) {
        return {};
    }
    return {extraHeaders: headers};
}

export function aiGatewayRunOptions(config?: AiGatewayConfig) {
    const options: {
        gateway: { id: string };
        extraHeaders?: Record<string, string>;
    } = {
        gateway: {id: resolveGatewayId(config?.gatewayId)},
    };

    const headers = buildGatewayExtraHeaders(config);
    if (Object.keys(headers).length > 0) {
        options.extraHeaders = headers;
    }

    return options;
}

export async function callAiModel(
    ai: Ai,
    model: string,
    inputs: Record<string, unknown>,
    config?: AiGatewayConfig,
): Promise<unknown> {
    const options = shouldUseAiGateway(model, inputs)
        ? aiGatewayRunOptions(config)
        : buildExtraHeadersOnly(config);

    return ai.run(model as any, inputs as any, options as any);
}
