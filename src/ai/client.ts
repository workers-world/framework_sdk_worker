import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

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
  } catch (e: unknown) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const resp = await env.SVC_LLM_GATEWAY.fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
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
