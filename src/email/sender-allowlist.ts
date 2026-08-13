/** 提取发件人邮箱地址（兼容 "Name <a@b.c>" 与裸地址），统一小写 */
export function extractEmailAddress(from: string | undefined): string {
    const m = (from ?? '').match(/[\w.+-]+@[\w.-]+/);
    return m?.[0]?.toLowerCase() ?? '';
}

/**
 * 发件人白名单校验：未配置白名单时一律拒绝（fail-closed）。
 * rawAllowlist 为逗号分隔邮箱。
 */
export function isAllowedSender(
    rawAllowlist: string | undefined,
    from: string | undefined,
): boolean {
    const raw = rawAllowlist?.trim();
    if (!raw) {
        return false;
    }
    const allowed = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
    return allowed.has(extractEmailAddress(from));
}
