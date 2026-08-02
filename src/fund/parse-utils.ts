/** 外部行情响应共用的解析工具：Eastmoney / Tencent 两个数据源共用。 */

/** 解析小数（保留 4 位），无效输入返回 null */
export function parseDecimal(raw?: string): number | null {
    if (raw == null || raw === '') {
        return null;
    }
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) {
        return null;
    }
    return Math.round(n * 10000) / 10000;
}

/** 解析百分比字符串（如 "0.57%" → 0.0057），无效输入返回 null */
export function parsePct(raw?: string): number | null {
    if (raw == null || raw === '') {
        return null;
    }
    const cleaned = String(raw).trim().replace('%', '');
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
        return null;
    }
    return Math.round(n * 10000) / 10000 / 100;
}

/** 归一化净值日期：YYYYMMDD → YYYY-MM-DD，已是后者则原样返回 */
export function formatNavDate(raw?: string): string {
    const text = String(raw ?? '').trim();
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return text;
    }
    return text || '';
}
