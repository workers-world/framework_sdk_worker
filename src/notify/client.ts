import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

/** notify Service Binding 调用超时，避免热路径无限挂起 */
const NOTIFY_FETCH_TIMEOUT_MS = 15_000;

// 附件
export interface NotifyAttachment {
    filename: string;
    /** base64 编码的二进制内容 */
    contentBase64: string;
    contentType?: string;
}

export interface NotifyPayload {
    subject: string;
    /** 纯文本正文；与 html 至少提供一个 */
    body?: string;
    /** HTML 正文；与 body 至少提供一个 */
    html?: string;
    to?: string;
    dedupKey?: string;
    attachments?: NotifyAttachment[];
}

export interface NotifyResult {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    id?: string;
    error?: string;
    status?: number;
}

export interface NotifyAsyncResult {
    ok: boolean;
    queued?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
    status?: number;
}

export interface DigestItemBase {
    ruleId: string;
    subjectPrefix: string;
    to: string;
    itemDedupKey?: string;
    source?: string;
}

/** HN 等：LLM 摘要片段，由 notify-worker 窗口内合并为 digest */
export interface DigestItemLlm extends DigestItemBase {
    itemFormat: 'llm';
    title: string;
    summary: string;
    url: string;
}

/** 其他订阅：原邮件原文，窗口内合并为 digest，不做改写 */
export interface DigestItemRaw extends DigestItemBase {
    itemFormat: 'raw';
    originalSubject: string;
    originalFrom: string;
    originalText: string;
    originalHtml: string;
}

export type DigestItem = DigestItemLlm | DigestItemRaw;

type NotifyJsonParseResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string; status: number };

/** 安全解析 notify 响应；空 body 或非 JSON 不向上抛，避免上游 process_exception */
async function parseNotifyJsonResponse<T extends { error?: string }>(
    resp: Response,
): Promise<NotifyJsonParseResult<T>> {
    const text = (await resp.text()).trim();
    if (!text) {
        return {
            ok: false,
            error: resp.ok ? 'notify empty response' : resp.statusText || 'notify error',
            status: resp.status,
        };
    }
    try {
        return { ok: true, data: JSON.parse(text) as T };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            ok: false,
            error: `notify invalid JSON: ${msg}`,
            status: resp.status,
        };
    }
}

/**
 * 通过 Service Binding 调用 notify-worker 发邮件。
 * host 填 https://notify 即可，Service Binding 会路由到 notify-worker，不走公网。
 * token 支持 string（.dev.vars）或 Secrets Store binding。
 */
export async function sendNotify(
    notify: Fetcher | undefined,
    token: SecretLike | undefined,
    payload: NotifyPayload,
): Promise<NotifyResult> {
    if (!notify) {
        return { ok: false, error: 'NOTIFY service binding not configured' };
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return { ok: false, error: 'NOTIFY_AUTH_TOKEN not configured' };
    }

    const resp = await notify.fetch('https://notify/v1/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolved}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(NOTIFY_FETCH_TIMEOUT_MS),
    });

    const parsed = await parseNotifyJsonResponse<NotifyResult>(resp);
    if (!parsed.ok) {
        return { ok: false, error: parsed.error, status: parsed.status };
    }
    const data = parsed.data;
    if (!resp.ok) {
        return {
            ok: false,
            error: data.error || resp.statusText,
            status: resp.status,
        };
    }
    // 上游 2xx 但 body 里 ok 字段缺失（如 {}）：类型上承诺 ok:boolean，这里归一为失败
    if (data.ok !== true) {
        return {
            ok: false,
            error: data.error || 'notify 响应缺少 ok:true',
            status: resp.status,
            reason: data.reason,
        };
    }
    return data;
}

/**
 * 异步 digest 入队：单条 DigestItem 进入 notify-outbound Queue，
 * 由 notify-worker 在 30 分钟窗口内按 ruleId+to 合并后发送。
 */
export async function sendNotifyAsync(
    notify: Fetcher | undefined,
    token: SecretLike | undefined,
    item: DigestItem,
): Promise<NotifyAsyncResult> {
    if (!notify) {
        return { ok: false, error: 'NOTIFY service binding not configured' };
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return { ok: false, error: 'NOTIFY_AUTH_TOKEN not configured' };
    }

    const resp = await notify.fetch('https://notify/v1/send/async', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolved}`,
            ...(item.source ? { 'X-Notify-Source': item.source } : {}),
        },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(NOTIFY_FETCH_TIMEOUT_MS),
    });

    const parsed = await parseNotifyJsonResponse<NotifyAsyncResult>(resp);
    if (!parsed.ok) {
        return { ok: false, error: parsed.error, status: parsed.status };
    }
    const data = parsed.data;
    if (!resp.ok) {
        return {
            ok: false,
            error: data.error || resp.statusText,
            status: resp.status,
        };
    }
    if (data.ok !== true) {
        return {
            ok: false,
            error: data.error || 'notify 响应缺少 ok:true',
            status: resp.status,
            reason: data.reason,
        };
    }
    return data;
}
