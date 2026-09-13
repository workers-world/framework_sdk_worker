/**
 * 本地联调跳过管理 API Bearer。
 * - skipFlag = 1|true|yes → 显式开
 * - 或 environment = development
 * 生产 ENVIRONMENT=production 且勿设 *_SKIP_ADMIN_AUTH。
 */
export function isAdminAuthSkipped(input: {
    environment?: string | null;
    skipFlag?: string | null;
}): boolean {
    const flag = (input.skipFlag || '').trim().toLowerCase();
    if (flag === '1' || flag === 'true' || flag === 'yes') {
        return true;
    }
    return (input.environment || '').trim().toLowerCase() === 'development';
}

/** 从 Env 记录读取 skip 判定（供 middleware / 路由复用） */
export function isAdminAuthSkippedFromEnv(
    env: object,
    options?: { skipFlagEnvKey?: string },
): boolean {
    const record = env as Record<string, unknown>;
    const environment = typeof record.ENVIRONMENT === 'string' ? record.ENVIRONMENT : undefined;
    const skipFlagKey = options?.skipFlagEnvKey;
    const skipFlag =
        skipFlagKey && typeof record[skipFlagKey] === 'string'
            ? (record[skipFlagKey] as string)
            : undefined;
    return isAdminAuthSkipped({ environment, skipFlag });
}
