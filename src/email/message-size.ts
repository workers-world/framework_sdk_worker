/**
 * 邮件整封大小估算（CF Email / Resend 整封上限校验共用）。
 * 附件按 contentBase64 字符串长度计（与 MIME base64 一致）。
 */

export const EMAIL_SIZE_EXCEEDED = 'EMAIL_SIZE_EXCEEDED';

/** verified destination 默认整封上限 */
export const DEFAULT_EMAIL_MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** 非 verified 收件人整封上限 */
export const DEFAULT_EMAIL_MAX_MESSAGE_BYTES_UNVERIFIED = 5 * 1024 * 1024;

/** MIME / headers 固定余量 */
export const EMAIL_MESSAGE_SIZE_OVERHEAD_BYTES = 2048;

export interface EmailSizeAttachment {
    contentBase64: string;
}

export function utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

/** 估算整封邮件字节数：正文 + 附件 base64 + 固定余量 */
export function estimateEmailMessageBytes(
    body?: string,
    html?: string,
    attachments?: EmailSizeAttachment[],
): number {
    let total = EMAIL_MESSAGE_SIZE_OVERHEAD_BYTES;
    if (body) {
        total += utf8ByteLength(body);
    }
    if (html) {
        total += utf8ByteLength(html);
    }
    if (attachments?.length) {
        for (const a of attachments) {
            total += a.contentBase64.length;
        }
    }
    return total;
}

export function parseEmailMaxMessageBytes(
    raw: string | undefined,
    fallback = DEFAULT_EMAIL_MAX_MESSAGE_BYTES,
): number {
    if (!raw?.trim()) {
        return fallback;
    }
    const n = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return n;
}

/** 原始字节 → base64 后长度（装箱预算用） */
export function estimateBase64Length(rawBytes: number): number {
    return Math.ceil(rawBytes / 3) * 4;
}
