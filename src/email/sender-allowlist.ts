/** 提取发件人邮箱地址（兼容 "Name <a@b.c>" 与裸地址），统一小写 */
export function extractEmailAddress(from: string | undefined): string {
    const trimmed = (from ?? '').trim();
    if (!trimmed) {
        return '';
    }
    // RFC 5322：mailbox 为末尾 <addr-spec>；显示名可含尖括号，须取最后一对
    const bracketMatches = [...trimmed.matchAll(/<([^>]+)>/g)];
    if (bracketMatches.length > 0) {
        const email = bracketMatches[bracketMatches.length - 1][1].trim().toLowerCase();
        return email.includes('@') ? email : '';
    }
    const bareMatch = trimmed.match(/^[\w.+-]+@[\w.-]+$/);
    return bareMatch?.[0]?.toLowerCase() ?? '';
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
