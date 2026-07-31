/** 六位纯数字视为公募基金代码 */
export function normalizeFundCode(raw: string): string {
    const code = String(raw ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
        throw new Error(`invalid fund code: ${raw}`);
    }
    return code;
}

export function isFundCode(raw: string): boolean {
    return /^\d{6}$/.test(String(raw ?? '').trim());
}
