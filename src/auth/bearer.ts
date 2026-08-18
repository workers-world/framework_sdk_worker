export interface BearerAuthResult {
    ok: boolean;
    status?: 401 | 503;
    error?: string;
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
        return {ok: false, status: 401, error: 'Unauthorized'};
    }

    const auth = authorizationHeader || '';
    if (auth !== `Bearer ${expectedToken}`) {
        return {ok: false, status: 401, error: 'Unauthorized'};
    }

    return {ok: true};
}

export function authorizeRequest(request: Request, expectedToken: string | undefined): boolean {
    return checkBearerToken(request.headers.get('Authorization'), expectedToken).ok;
}
