/**
 * 兼容 per-Worker secret（string）与 Secrets Store binding（{ get() }）。
 * 本地 .dev.vars 仍为 string；生产可绑 Secrets Store。
 */
export type SecretLike = string | { get(): Promise<string> };

export async function resolveSecret(
    value: SecretLike | undefined | null,
): Promise<string | undefined> {
    if (value == null) {
        return undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value.get === 'function') {
        const resolved = await value.get();
        const trimmed = typeof resolved === 'string' ? resolved.trim() : '';
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return undefined;
}
