import {resolveSecret, type SecretLike} from '../secrets/resolve.js';

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
 */
export async function generateId(
    counter: Fetcher | undefined,
    token: SecretLike | undefined,
    prefix: string,
): Promise<GenerateIdResult> {
    if (!counter) {
        return {ok: false, error: 'SVC_COUNTER service binding not configured'};
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return {ok: false, error: 'COUNTER_AUTH_TOKEN not configured'};
    }

    const resp = await counter.fetch('https://counter/v1/id', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolved}`,
        },
        body: JSON.stringify({prefix} satisfies GenerateIdRequest),
    });

    const data = (await resp.json()) as GenerateIdResult & { error?: string; code?: string };
    if (!resp.ok) {
        return {
            ok: false,
            error: data.error || resp.statusText,
            status: resp.status,
            code: data.code,
        };
    }
    return data;
}
