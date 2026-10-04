/**
 * 附件共同祖先与两种运送方式：
 * - AttachmentContent：载荷内带 base64（即时 /v1/send）
 * - AttachmentReference：只带 r2Key（队列 / 跨 Worker 后再取字节）
 */

/** 共同祖先：凡附件必有名 */
export interface Attachment {
    filename: string;
    contentType?: string;
}

/** 载荷里带着文件内容 —— 即时 /v1/send */
export interface AttachmentContent extends Attachment {
    contentBase64: string;
}

/** 只带着对象键 —— 过队列、跨 Worker 后再取字节 */
export interface AttachmentReference extends Attachment {
    r2Key?: string;
    sizeBytes?: number;
    /**
     * 不进 MIME 的旁路（如视频 rclone 整行命令）。
     * 有 r2Key 时 notify 仍只按 r2Key 水合；仅 href 则渲染进正文、不删对象。
     */
    href?: string;
}

/**
 * digest 合窗：Reference + 业务 kind（notify 不解释 kind）。
 * 图/PDF：必有 r2Key。视频：{ kind:'video', href } 无 r2Key。
 */
export interface DigestAttachmentReference extends AttachmentReference {
    kind: string;
}

/** 需要从 R2 取字节挂 MIME 的引用 */
export function hasDigestAttachBytes(
    ref: DigestAttachmentReference,
): ref is DigestAttachmentReference & { r2Key: string } {
    return Boolean(ref.r2Key);
}

/** 正文打印用（rclone 等）；无 r2Key */
export function hasDigestHrefOnly(ref: DigestAttachmentReference): boolean {
    return Boolean(ref.href) && !ref.r2Key;
}
