import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

/** counter-worker 挂起时避免拖死调用方 isolate（发号是热路径前置依赖） */
const COUNTER_CALL_TIMEOUT_MS = 8_000;

export interface GenerateIdResult {
    ok: boolean;
    id?: string;
    error?: string;
    status?: number;
    code?: string;
}

export interface GenerateIdRequest {
    prefix: string;
}

/**
 * 通过 Service Binding 调用 counter-worker 生成 ID。
 * host 填 https://counter 即可，Service Binding 会路由到 counter-worker，不走公网。
 * 网络异常/超时/非 JSON 响应一律返回 {ok:false}，不向调用方抛裸异常。
 */
export async function generateId(
    counter: Fetcher | undefined,
    token: SecretLike | undefined,
    prefix: string,
): Promise<GenerateIdResult> {
    if (!counter) {
        return { ok: false, error: 'SVC_COUNTER service binding not configured' };
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return { ok: false, error: 'COUNTER_AUTH_TOKEN not configured' };
    }

    try {
        const resp = await counter.fetch('https://counter/v1/id', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${resolved}`,
            },
            body: JSON.stringify({ prefix } satisfies GenerateIdRequest),
            signal: AbortSignal.timeout(COUNTER_CALL_TIMEOUT_MS),
        });

        const data = (await resp.json().catch(() => null)) as
            | (GenerateIdResult & {
                  error?: string;
                  code?: string;
              })
            | null;
        if (!resp.ok) {
            return {
                ok: false,
                error: data?.error || resp.statusText,
                status: resp.status,
                code: data?.code,
            };
        }
        if (!data?.ok) {
            return {
                ok: false,
                error: data?.error || `counter 响应异常（HTTP ${resp.status}）`,
                status: resp.status,
                code: data?.code,
            };
        }
        return data;
    } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
