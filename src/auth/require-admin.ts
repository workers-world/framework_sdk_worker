import { checkBearerToken } from './bearer.js';

/**
 * 非 Hono 入口的 Bearer 鉴权：校验失败返回 401/503 Response，通过返回 null。
 * token 由调用方 resolveSecret 后传入。
 */
export async function requireAdminAuth(
    request: Request,
    token: string | undefined,
): Promise<Response | null> {
    const result = checkBearerToken(request.headers.get('Authorization'), token, {
        requireConfigured: true,
        missingConfigMessage: 'RULES_ADMIN_TOKEN not configured',
    });
    if (result.ok) {
        return null;
    }
    return new Response(JSON.stringify({ ok: false, error: result.error ?? 'Unauthorized' }), {
        status: result.status ?? 401,
        headers: { 'Content-Type': 'application/json' },
    });
}
