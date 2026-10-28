import type { CostSource } from './types.js';

export interface ReviewGatewayMetadata {
    runId: string;
    owner: string;
    repo: string;
    pr: number;
}

/** ≤5 AI Gateway metadata keys (runId + repo context). */
export function buildReviewGatewayMetadata(input: ReviewGatewayMetadata): Record<string, string> {
    return {
        runId: input.runId,
        owner: input.owner,
        repo: input.repo,
        pr: String(input.pr),
    };
}

interface GatewayLogRow {
    cost?: number | string | null;
    metadata?: Record<string, unknown> | null;
}

function asCost(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function metadataRunId(row: GatewayLogRow, expected: string): boolean {
    const meta = row.metadata;
    if (!meta || typeof meta !== 'object') {
        return false;
    }
    const runId = meta.runId;
    return typeof runId === 'string' && runId === expected;
}

export type FetchAiGatewayCostOnceResult =
    | { status: 'no_credentials' }
    | { status: 'api_error'; httpStatus: number }
    | { status: 'invalid_response' }
    | { status: 'ok'; costUsd: number; matched: number };

export type AwaitAiGatewayCostResult =
    | { outcome: 'ok'; costUsd: number; matched: number; attempts: number }
    | { outcome: 'no_credentials' }
    | { outcome: 'api_failed'; attempts: number; lastHttpStatus?: number };

export type AiGatewayCostLogFn = (event: string, detail?: Record<string, unknown>) => void;

/** Cloudflare AI Gateway logs API max (HTTP 400 error 7001 if exceeded). */
export const AI_GATEWAY_LOGS_PER_PAGE = 50;

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const MAX_BACKOFF_MS = 16_000;

function backoffDelayMs(initialDelayMs: number, attemptIndex: number): number {
    const delay = initialDelayMs * 2 ** attemptIndex;
    return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * One paginated pass over AI Gateway logs for a runId (no retry).
 */
export async function fetchAiGatewayCostOnce(options: {
    accountId?: string;
    apiToken?: string;
    gatewayId: string;
    runId: string;
    startedAtMs: number;
    fetchImpl?: typeof fetch;
}): Promise<FetchAiGatewayCostOnceResult> {
    const accountId = options.accountId?.trim();
    const apiToken = options.apiToken?.trim();
    if (!accountId || !apiToken) {
        return { status: 'no_credentials' };
    }

    const fetchFn = options.fetchImpl ?? fetch;
    const since = new Date(options.startedAtMs - 60_000).toISOString();
    let page = 1;
    let total = 0;
    let matched = 0;
    for (;;) {
        const url = new URL(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${encodeURIComponent(options.gatewayId)}/logs`,
        );
        url.searchParams.set('per_page', String(AI_GATEWAY_LOGS_PER_PAGE));
        url.searchParams.set('page', String(page));
        url.searchParams.set('search', options.runId);
        url.searchParams.set('from', since);

        const response = await fetchFn(url.toString(), {
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            return { status: 'api_error', httpStatus: response.status };
        }

        const body = (await response.json()) as {
            success?: boolean;
            result?: GatewayLogRow[];
            result_info?: { total_pages?: number };
        };
        if (!body.success || !Array.isArray(body.result)) {
            return { status: 'invalid_response' };
        }

        for (const row of body.result) {
            if (!metadataRunId(row, options.runId)) {
                continue;
            }
            matched += 1;
            total += asCost(row.cost);
        }

        const totalPages = body.result_info?.total_pages ?? page;
        if (page >= totalPages || body.result.length === 0) {
            break;
        }
        page += 1;
        if (page > 20) {
            break;
        }
    }

    return { status: 'ok', costUsd: total, matched };
}

/**
 * Poll AI Gateway logs until costs appear or attempts exhaust (~tens of seconds).
 */
export async function awaitAiGatewayCostUsd(options: {
    accountId?: string;
    apiToken?: string;
    gatewayId: string;
    runId: string;
    startedAtMs: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    log?: AiGatewayCostLogFn;
    maxAttempts?: number;
    initialDelayMs?: number;
}): Promise<AwaitAiGatewayCostResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const log = options.log ?? (() => {});

    let lastHttpStatus: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (attempt > 1) {
            const delayMs = backoffDelayMs(initialDelayMs, attempt - 2);
            log('ai_gateway_cost_retry_wait', { attempt, delayMs, runId: options.runId });
            await sleep(delayMs);
        }

        const once = await fetchAiGatewayCostOnce(options);

        if (once.status === 'no_credentials') {
            log('ai_gateway_cost_no_credentials', { runId: options.runId });
            return { outcome: 'no_credentials' };
        }

        if (once.status === 'api_error') {
            lastHttpStatus = once.httpStatus;
            log('ai_gateway_cost_api_error', {
                attempt,
                httpStatus: once.httpStatus,
                runId: options.runId,
            });
            if (attempt === maxAttempts) {
                return { outcome: 'api_failed', attempts: attempt, lastHttpStatus };
            }
            continue;
        }

        if (once.status === 'invalid_response') {
            log('ai_gateway_cost_invalid_response', { attempt, runId: options.runId });
            if (attempt === maxAttempts) {
                return { outcome: 'api_failed', attempts: attempt, lastHttpStatus };
            }
            continue;
        }

        if (once.matched > 0) {
            log('ai_gateway_cost_matched', {
                attempt,
                matched: once.matched,
                costUsd: once.costUsd,
                runId: options.runId,
            });
            return {
                outcome: 'ok',
                costUsd: once.costUsd,
                matched: once.matched,
                attempts: attempt,
            };
        }

        log('ai_gateway_cost_matched_zero', { attempt, runId: options.runId });
        if (attempt === maxAttempts) {
            return { outcome: 'ok', costUsd: 0, matched: 0, attempts: attempt };
        }
    }

    return { outcome: 'api_failed', attempts: maxAttempts, lastHttpStatus };
}

/**
 * @deprecated Prefer `awaitAiGatewayCostUsd` — single attempt, null on failure.
 */
export async function sumAiGatewayCostUsd(options: {
    accountId?: string;
    apiToken?: string;
    gatewayId: string;
    runId: string;
    startedAtMs: number;
    fetchImpl?: typeof fetch;
}): Promise<number | null> {
    const once = await fetchAiGatewayCostOnce(options);
    if (once.status === 'no_credentials') {
        return null;
    }
    if (once.status !== 'ok') {
        return null;
    }
    return once.matched > 0 ? once.costUsd : 0;
}

/**
 * Resolve cost after gateway lookup.
 * Empty-log (matched=0)：`ai_gateway` + 0 — Gateway is authoritative.
 * API fail / no credentials：message cost → `provider_reported`，否则 `none`。
 */
export function resolveGatewayCostUsd(options: {
    gateway: AwaitAiGatewayCostResult;
    messageCostUsd: number;
}): { costUsd: number; source: CostSource } {
    if (options.gateway.outcome === 'ok') {
        return { costUsd: options.gateway.costUsd, source: 'ai_gateway' };
    }
    if (options.messageCostUsd > 0) {
        return { costUsd: options.messageCostUsd, source: 'provider_reported' };
    }
    return { costUsd: 0, source: 'none' };
}

/** @deprecated Use {@link resolveGatewayCostUsd}; maps `provider_reported` → `message_fallback` for old callers. */
export function resolveReviewCostUsd(options: {
    gateway: AwaitAiGatewayCostResult;
    messageCostUsd: number;
}): { costUsd: number; costSource: 'ai_gateway' | 'message_fallback' | 'none' } {
    const resolved = resolveGatewayCostUsd(options);
    if (resolved.source === 'provider_reported') {
        return { costUsd: resolved.costUsd, costSource: 'message_fallback' };
    }
    if (resolved.source === 'ai_gateway') {
        return { costUsd: resolved.costUsd, costSource: 'ai_gateway' };
    }
    return { costUsd: 0, costSource: 'none' };
}
