export interface NotifyPayload {
  subject: string;
  body: string;
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
