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

export function aiGatewayRunOptions(config?: AiGatewayConfig) {
  const options: {
    gateway: { id: string };
    extraHeaders?: Record<string, string>;
  } = {
    gateway: { id: resolveGatewayId(config?.gatewayId) },
  };

  const headers: Record<string, string> = {};
  const token = config?.authToken?.trim();
  if (token) {
    headers['cf-aig-authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }
  const alias = config?.byokAlias?.trim();
  if (alias) {
    headers['cf-aig-byok-alias'] = alias;
  }
  if (Object.keys(headers).length > 0) {
    options.extraHeaders = headers;
  }

  return options;
}

export async function runAiModel(
  ai: Ai,
  model: string,
  inputs: Record<string, unknown>,
  config?: AiGatewayConfig,
): Promise<unknown> {
  return ai.run(
    model as any,
    inputs as any,
    aiGatewayRunOptions(config) as any,
  );
}
