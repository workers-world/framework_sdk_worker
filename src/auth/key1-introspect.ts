import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

export type Key1IntrospectSuccess = {
    ok: true;
    principal: string;
    scopes: string[];
    credentialId: string;
};

export type Key1IntrospectFailure = {
    ok: false;
    status: number;
    error: string;
};

export type Key1IntrospectResult = Key1IntrospectSuccess | Key1IntrospectFailure;

function asRecord(v: unknown): Record<string, unknown> | null {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>;
    }
    return null;
}

/**
 * 经 Service Binding 向 key1 校验 bot opaque key。
 * `authToken` 为 KEY1_AUTH_TOKEN（Worker→key1），`presentedToken` 为客户端 Bearer。
 */
export async function introspectKey1Token(opts: {
    fetcher: Fetcher;
    authToken: SecretLike | undefined;
    presentedToken: string;
}): Promise<Key1IntrospectResult> {
    const m2m = await resolveSecret(opts.authToken);
    if (!m2m) {
        return { ok: false, status: 503, error: 'KEY1_AUTH_TOKEN not configured' };
    }
    let res: Response;
    try {
        res = await opts.fetcher.fetch('https://key1/internal/v1/introspect', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${m2m}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: opts.presentedToken }),
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 503, error: `key1 introspect failed: ${message}` };
    }
    let json: unknown;
    try {
        json = await res.json();
    } catch {
        return { ok: false, status: res.status, error: 'Unauthorized' };
    }
    const rec = asRecord(json);
    if (!res.ok || !rec) {
        const err = rec && typeof rec.error === 'string' ? rec.error : 'Unauthorized';
        return { ok: false, status: res.status === 403 ? 403 : 401, error: err };
    }
    const principal = typeof rec.principal === 'string' ? rec.principal : '';
    const credentialId = typeof rec.credentialId === 'string' ? rec.credentialId : '';
    const scopes = Array.isArray(rec.scopes)
        ? rec.scopes.filter((s): s is string => typeof s === 'string')
        : [];
    if (!rec.ok || !principal || !credentialId) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: true, principal, scopes, credentialId };
}
