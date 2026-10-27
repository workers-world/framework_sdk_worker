export interface BearerAuthResult {
    ok: boolean;
    status?: 401 | 503;
    error?: string;
}

/**
 * 常数时间字符串比较：按较长串长度逐 code unit XOR 累积，不因内容差异提前返回，
 * 消除 Bearer token 逐字节计时侧信道（OWASP 对 secret 比较的标准要求）。
 * 纯同步实现以保持既有 API；长度差异仍反映在循环次数上，但 token 长度本身非机密。
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
    const max = a.length > b.length ? a.length : b.length;
    let diff = a.length ^ b.length;
    for (let i = 0; i < max; i++) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
}

export function checkBearerToken(
    authorizationHeader: string | null | undefined,
    expectedToken: string | undefined,
    options?: { requireConfigured?: boolean; missingConfigMessage?: string },
): BearerAuthResult {
    if (!expectedToken) {
        if (options?.requireConfigured) {
            return {
                ok: false,
                status: 503,
                error: options.missingConfigMessage || 'Auth token not configured',
            };
        }
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const auth = authorizationHeader || '';
    if (!timingSafeEqualStrings(auth, `Bearer ${expectedToken}`)) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    return { ok: true };
}

export function authorizeRequest(request: Request, expectedToken: string | undefined): boolean {
    return checkBearerToken(request.headers.get('Authorization'), expectedToken).ok;
}
