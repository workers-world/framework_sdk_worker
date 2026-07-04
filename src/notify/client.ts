export interface NotifyPayload {
  subject: string;
  /** 纯文本正文；与 html 至少提供一个 */
  body?: string;
  /** HTML 正文；与 body 至少提供一个 */
  html?: string;
  to?: string;
  dedupKey?: string;
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

/**
 * 通过 Service Binding 调用 notify-worker 发邮件。
 * host 填 https://notify 即可，Service Binding 会路由到 notify-worker，不走公网。
 */
export async function sendNotify(
  notify: Fetcher | undefined,
  token: string | undefined,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  if (!notify) {
    return { ok: false, error: 'NOTIFY service binding not configured' };
  }
  if (!token) {
    return { ok: false, error: 'NOTIFY_AUTH_TOKEN not configured' };
  }

  const resp = await notify.fetch('https://notify/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await resp.json()) as NotifyResult;
  if (!resp.ok) {
    return {
      ok: false,
      error: data.error || resp.statusText,
      status: resp.status,
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
  token: string | undefined,
  item: DigestItem,
): Promise<NotifyAsyncResult> {
  if (!notify) {
    return { ok: false, error: 'NOTIFY service binding not configured' };
  }
  if (!token) {
    return { ok: false, error: 'NOTIFY_AUTH_TOKEN not configured' };
  }

  const resp = await notify.fetch('https://notify/v1/send/async', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(item.source ? { 'X-Notify-Source': item.source } : {}),
    },
    body: JSON.stringify(item),
  });

  const data = (await resp.json()) as NotifyAsyncResult;
  if (!resp.ok) {
    return {
      ok: false,
      error: data.error || resp.statusText,
      status: resp.status,
    };
  }
  return data;
}
