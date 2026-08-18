/**
 * 通用维护日志 client：通过 Service Binding 调用 audit-log-worker 写入日志。
 * host 填 https://audit-log 即可，Service Binding 会路由到 audit-log-worker，不走公网。
 * 上游：各 worker（config-agent / email-rule-worker ...）；下游：audit-log-worker POST /v1/log。
 */
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

export interface MaintenanceLogEntry {
    ts: string;
    actor: string;
    worker: string;
    service: string;
    action: string;
    target: string;
    tech: string;
    before?: string;
    after?: string;
    traceId: string;
    opId?: string;
    detail?: string;
}

export interface WriteLogResult {
    ok: boolean;
    id?: number;
    error?: string;
}

export async function writeMaintenanceLog(
    logger: Fetcher | undefined,
    token: SecretLike | undefined,
    entry: MaintenanceLogEntry,
): Promise<WriteLogResult> {
    if (!logger) {
        return { ok: false, error: 'SVC_AUDIT_LOG service binding not configured' };
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return { ok: false, error: 'AUDIT_LOG_AUTH_TOKEN not configured' };
    }

    const resp = await logger.fetch('https://audit-log/v1/log', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolved}`,
        },
        body: JSON.stringify(entry satisfies MaintenanceLogEntry),
    });

    const data = (await resp.json()) as WriteLogResult & { error?: string };
    if (!resp.ok) {
        return { ok: false, error: data.error || resp.statusText };
    }
    return data;
}
