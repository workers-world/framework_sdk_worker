import { isAdminAuthSkipped } from './admin-auth-skip.js';
import { checkBearerToken } from './bearer.js';

export interface RequireAdminAuthOptions {
    /** 缺 token 时的错误文案 */
    missingConfigMessage?: string;
    /** 为 true 时跳过 Bearer（本地联调） */
    skip?: boolean;
    environment?: string | null;
    skipFlag?: string | null;
}

/**
 * 非 Hono 入口的 Bearer 鉴权：校验失败返回 401/503 Response，通过返回 null。
 * token 由调用方 resolveSecret 后传入。
 */
export async function requireAdminAuth(
    request: Request,
    token: string | undefined,
    options?: RequireAdminAuthOptions,
): Promise<Response | null> {
    const skip =
        options?.skip === true ||
        isAdminAuthSkipped({
            environment: options?.environment,
            skipFlag: options?.skipFlag,
        });
    if (skip) {
        return null;
    }

    const result = checkBearerToken(request.headers.get('Authorization'), token, {
        requireConfigured: true,
        missingConfigMessage: options?.missingConfigMessage ?? 'RULES_ADMIN_TOKEN not configured',
    });
    if (result.ok) {
        return null;
    }
    return new Response(JSON.stringify({ ok: false, error: result.error ?? 'Unauthorized' }), {
        status: result.status ?? 401,
        headers: { 'Content-Type': 'application/json' },
    });
}
