/**
 * 通用维护日志 client：通过 Service Binding 调用 audit-log-worker 写入/查询日志。
 * host 填 https://audit-log 即可，Service Binding 会路由到 audit-log-worker，不走公网。
 * 上游：各 worker（config-agent / orchestrator-worker ...）；下游：audit-log-worker。
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

export interface MaintenanceLogRow extends MaintenanceLogEntry {
    id: number;
}

export interface MaintenanceLogQuery {
    worker?: string;
    service?: string;
    action?: string;
    traceId?: string;
    sinceTs?: string;
    sinceId?: number;
    afterId?: number;
    order?: 'asc' | 'desc';
    limit?: number;
}

export interface QueryMaintenanceLogsResult {
    ok: boolean;
    rows?: MaintenanceLogRow[];
    nextAfterId?: number;
    error?: string;
}

export interface WriteLogResult {
    ok: boolean;
    id?: number;
    error?: string;
}

function rowFromDb(raw: Record<string, unknown>): MaintenanceLogRow {
    return {
        id: Number(raw.id),
        ts: String(raw.ts),
        actor: String(raw.actor),
        worker: String(raw.worker),
        service: String(raw.service),
        action: String(raw.action),
        target: String(raw.target),
        tech: String(raw.tech),
        before: raw.before != null ? String(raw.before) : undefined,
        after: raw.after != null ? String(raw.after) : undefined,
        traceId: String(raw.trace_id ?? raw.traceId ?? ''),
        opId: raw.op_id != null ? String(raw.op_id) : raw.opId != null ? String(raw.opId) : undefined,
        detail: raw.detail != null ? String(raw.detail) : undefined,
    };
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

/** 查询维护日志（单页）；order=asc + afterId 用于日报增量分页。 */
export async function queryMaintenanceLogs(
    logger: Fetcher | undefined,
    token: SecretLike | undefined,
    query: MaintenanceLogQuery,
): Promise<QueryMaintenanceLogsResult> {
    if (!logger) {
        return { ok: false, error: 'SVC_AUDIT_LOG service binding not configured' };
    }
    const resolved = await resolveSecret(token);
    if (!resolved) {
        return { ok: false, error: 'AUDIT_LOG_AUTH_TOKEN not configured' };
    }

    const params = new URLSearchParams();
    if (query.worker) params.set('worker', query.worker);
    if (query.service) params.set('service', query.service);
    if (query.action) params.set('action', query.action);
    if (query.traceId) params.set('traceId', query.traceId);
    if (query.sinceTs) params.set('sinceTs', query.sinceTs);
    if (query.sinceId != null) params.set('sinceId', String(query.sinceId));
    if (query.afterId != null) params.set('afterId', String(query.afterId));
    if (query.order) params.set('order', query.order);
    if (query.limit != null) params.set('limit', String(query.limit));

    const resp = await logger.fetch(`https://audit-log/v1/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${resolved}` },
    });

    const data = (await resp.json()) as {
        ok?: boolean;
        rows?: Record<string, unknown>[];
        nextAfterId?: number;
        error?: string;
    };
    if (!resp.ok) {
        return { ok: false, error: data.error || resp.statusText };
    }
    return {
        ok: true,
        rows: (data.rows ?? []).map(rowFromDb),
        nextAfterId: data.nextAfterId,
    };
}

/** 拉取 since 基准线以来的全部行（分页直至取尽）。 */
export async function queryMaintenanceLogsSince(
    logger: Fetcher | undefined,
    token: SecretLike | undefined,
    query: Omit<MaintenanceLogQuery, 'afterId' | 'limit'>,
    pageSize = 100,
): Promise<{ ok: boolean; rows: MaintenanceLogRow[]; error?: string }> {
    const rows: MaintenanceLogRow[] = [];
    let afterId: number | undefined;

    for (;;) {
        const page = await queryMaintenanceLogs(logger, token, {
            ...query,
            order: query.order ?? 'asc',
            limit: pageSize,
            afterId,
        });
        if (!page.ok) {
            return { ok: false, rows, error: page.error };
        }
        const batch = page.rows ?? [];
        if (batch.length === 0) {
            break;
        }
        rows.push(...batch);
        if (page.nextAfterId == null || batch.length < pageSize) {
            break;
        }
        afterId = page.nextAfterId;
    }

    return { ok: true, rows };
}
