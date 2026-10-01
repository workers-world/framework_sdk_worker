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
    r2Key: string;
    sizeBytes?: number;
}

/**
 * digest 合窗：Reference + 业务 kind（notify 不解释 kind）。
 * MVP kind 例：hn_comment_pdf
 */
export interface DigestAttachmentReference extends AttachmentReference {
    kind: string;
}
