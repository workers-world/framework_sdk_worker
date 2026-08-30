/**
 * 通用维护日志 client：通过 Service Binding 调用 audit-log-worker 写入/查询日志。
 * host 填 https://audit-log 即可，Service Binding 会路由到 audit-log-worker，不走公网。
 * 上游：各 worker（config-agent / orchestrator-worker ...）；下游：audit-log-worker。
 */
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

/** 上游 audit-log-worker 挂起时避免拖死调用方 isolate */
const AUDIT_LOG_TIMEOUT_MS = 10_000;

/** queryMaintenanceLogsSince 分页上限：上游分页异常时不至于烧穿 subrequest 配额 */
const MAX_PAGINATION_PAGES = 100;

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
        opId:
            raw.op_id != null ? String(raw.op_id) : raw.opId != null ? String(raw.opId) : undefined,
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

    try {
        const resp = await logger.fetch('https://audit-log/v1/log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${resolved}`,
            },
            body: JSON.stringify(entry satisfies MaintenanceLogEntry),
            signal: AbortSignal.timeout(AUDIT_LOG_TIMEOUT_MS),
        });

        const data = (await resp.json().catch(() => null)) as
            | (WriteLogResult & {
                  error?: string;
              })
            | null;
        if (!resp.ok) {
            return { ok: false, error: data?.error || resp.statusText };
        }
        if (!data) {
            return { ok: false, error: `audit-log 响应非 JSON（HTTP ${resp.status}）` };
        }
        return data;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
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
    if (query.worker) {
        params.set('worker', query.worker);
    }
    if (query.service) {
        params.set('service', query.service);
    }
    if (query.action) {
        params.set('action', query.action);
    }
    if (query.traceId) {
        params.set('traceId', query.traceId);
    }
    if (query.sinceTs) {
        params.set('sinceTs', query.sinceTs);
    }
    if (query.sinceId != null) {
        params.set('sinceId', String(query.sinceId));
    }
    if (query.afterId != null) {
        params.set('afterId', String(query.afterId));
    }
    if (query.order) {
        params.set('order', query.order);
    }
    if (query.limit != null) {
        params.set('limit', String(query.limit));
    }

    try {
        const resp = await logger.fetch(`https://audit-log/v1/logs?${params.toString()}`, {
            headers: { Authorization: `Bearer ${resolved}` },
            signal: AbortSignal.timeout(AUDIT_LOG_TIMEOUT_MS),
        });

        const data = (await resp.json().catch(() => null)) as {
            ok?: boolean;
            rows?: Record<string, unknown>[];
            nextAfterId?: number;
            error?: string;
        } | null;
        if (!resp.ok) {
            return { ok: false, error: data?.error || resp.statusText };
        }
        if (!data) {
            return { ok: false, error: `audit-log 响应非 JSON（HTTP ${resp.status}）` };
        }
        return {
            ok: true,
            rows: (data.rows ?? []).map(rowFromDb),
            nextAfterId: data.nextAfterId,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

/** 拉取 since 基准线以来的全部行（分页直至取尽；受 MAX_PAGINATION_PAGES 上限保护）。 */
export async function queryMaintenanceLogsSince(
    logger: Fetcher | undefined,
    token: SecretLike | undefined,
    query: Omit<MaintenanceLogQuery, 'afterId' | 'limit'>,
    pageSize = 100,
): Promise<{ ok: boolean; rows: MaintenanceLogRow[]; error?: string }> {
    const rows: MaintenanceLogRow[] = [];
    let afterId: number | undefined;
    let exhausted = false;

    for (let page = 0; page < MAX_PAGINATION_PAGES; page++) {
        const result = await queryMaintenanceLogs(logger, token, {
            ...query,
            order: query.order ?? 'asc',
            limit: pageSize,
            afterId,
        });
        if (!result.ok) {
            return { ok: false, rows, error: result.error };
        }
        const batch = result.rows ?? [];
        if (batch.length === 0) {
            exhausted = true;
            break;
        }
        rows.push(...batch);
        if (result.nextAfterId == null || batch.length < pageSize) {
            exhausted = true;
            break;
        }
        if (result.nextAfterId === afterId) {
            // 上游游标未前进：继续翻页只会重复，终止并如实上报
            return { ok: false, rows, error: 'audit-log 分页游标未前进' };
        }
        afterId = result.nextAfterId;
    }

    if (!exhausted) {
        // 达到分页页数上限仍未取尽：按失败上报，避免静默截断
        return { ok: false, rows, error: `audit-log 分页超过 ${MAX_PAGINATION_PAGES} 页上限` };
    }

    return { ok: true, rows };
}
