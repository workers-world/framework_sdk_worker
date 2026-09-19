/**
 * Workers Observability Query Builder 请求体（平台算 Top-N / p95 / count）。
 * 上游：orchestrator 优化日报、error burst。
 * 下游：POST .../workers/observability/telemetry/query view=calculations。
 * 不变量：不在本模块做分位数；只组请求、解析平台 aggregates。
 */

export const DEFAULT_WALL_KEY = '$workers.wallTimeMs';
export const DEFAULT_CPU_KEY = '$workers.cpuTimeMs';
export const DEFAULT_SCRIPT_KEY = '$workers.scriptName';
export const DEFAULT_PATH_KEY = '$workers.event.request.path';
export const DEFAULT_MESSAGE_KEY = '$metadata.message';
export const DEFAULT_LEVEL_KEY = '$metadata.level';

export type WaitHint = 'io' | 'cpu' | 'mixed';
export type CompareHint = 'regression' | 'chronic' | 'improved' | 'unknown';

export interface MetricCell {
    source: 'workers_observability';
    name: 'wall_time_ms';
    dims: { script: string; path?: string };
    window: { from: string; to: string };
    stats: { n: number; p95?: number; max?: number; cpuP50?: number };
    waitHint: WaitHint;
    fingerprint: string;
    compare: CompareHint;
}

export interface TelemetryCalc {
    operator: string;
    alias: string;
    key?: string;
    keyType?: 'string' | 'number' | 'boolean';
}

export interface CalculationAggregate {
    value?: number;
    count?: number;
    groups?: Array<{ key: string; value: string | number | boolean }>;
}

export interface CalculationResult {
    alias?: string;
    calculation?: string;
    aggregates?: CalculationAggregate[];
}

function calc(
    operator: string,
    alias: string,
    key: string,
    keyType: 'string' | 'number',
): TelemetryCalc {
    return { operator, alias, key, keyType };
}

export function buildLatencyTopNQuery(input: {
    fromMs: number;
    toMs: number;
    limit?: number;
    minCount?: number;
    pathKey?: string;
}): Record<string, unknown> {
    const pathKey = input.pathKey?.trim() || DEFAULT_PATH_KEY;
    const minCount = input.minCount ?? 20;
    return {
        queryId: 'opt-latency-topn',
        view: 'calculations',
        compare: true,
        ignoreSeries: true,
        limit: input.limit ?? 20,
        timeframe: { from: input.fromMs, to: input.toMs },
        parameters: {
            datasets: [],
            filterCombination: 'and',
            filters: [],
            calculations: [
                calc('count', 'n', DEFAULT_WALL_KEY, 'number'),
                calc('p95', 'wall_p95', DEFAULT_WALL_KEY, 'number'),
                calc('max', 'wall_max', DEFAULT_WALL_KEY, 'number'),
                calc('median', 'cpu_p50', DEFAULT_CPU_KEY, 'number'),
            ],
            groupBys: [
                { type: 'string', value: DEFAULT_SCRIPT_KEY },
                { type: 'string', value: pathKey },
            ],
            havings: [{ key: 'n', operation: 'gte', value: minCount }],
            orderBy: { value: 'wall_p95', order: 'desc' },
        },
    };
}

export function buildErrorBurstCalculationsQuery(input: {
    fromMs: number;
    toMs: number;
    threshold: number;
    limit?: number;
}): Record<string, unknown> {
    return {
        queryId: 'ops-error-burst',
        view: 'calculations',
        compare: false,
        ignoreSeries: true,
        limit: input.limit ?? 50,
        timeframe: { from: input.fromMs, to: input.toMs },
        parameters: {
            datasets: [],
            filterCombination: 'and',
            filters: [
                {
                    key: DEFAULT_LEVEL_KEY,
                    operation: 'eq',
                    type: 'string',
                    value: 'error',
                },
            ],
            calculations: [calc('count', 'n', DEFAULT_MESSAGE_KEY, 'string')],
            groupBys: [
                { type: 'string', value: DEFAULT_SCRIPT_KEY },
                { type: 'string', value: DEFAULT_MESSAGE_KEY },
            ],
            havings: [{ key: 'n', operation: 'gte', value: input.threshold }],
            orderBy: { value: 'n', order: 'desc' },
        },
    };
}

export function buildSlowTraceQuery(input: {
    fromMs: number;
    toMs: number;
    script: string;
    path?: string;
    pathKey?: string;
    limit?: number;
}): Record<string, unknown> {
    const filters: Array<Record<string, string>> = [
        {
            key: DEFAULT_SCRIPT_KEY,
            operation: 'eq',
            type: 'string',
            value: input.script,
        },
    ];
    if (input.path) {
        filters.push({
            key: input.pathKey?.trim() || DEFAULT_PATH_KEY,
            operation: 'eq',
            type: 'string',
            value: input.path,
        });
    }
    return {
        queryId: 'opt-latency-traces',
        view: 'traces',
        limit: input.limit ?? 5,
        timeframe: { from: input.fromMs, to: input.toMs },
        parameters: {
            datasets: [],
            filterCombination: 'and',
            filters,
            orderBy: { value: DEFAULT_WALL_KEY, order: 'desc' },
        },
    };
}

function groupKey(groups: CalculationAggregate['groups']): string {
    return (groups ?? [])
        .map((g) => `${g.key}=${String(g.value)}`)
        .sort()
        .join('\0');
}

function dim(groups: CalculationAggregate['groups'], key: string): string {
    const hit = (groups ?? []).find((g) => g.key === key);
    return hit == null ? '' : String(hit.value);
}

function indexCalcs(
    rows: CalculationResult[] | undefined,
): Map<string, Map<string, CalculationAggregate>> {
    const out = new Map<string, Map<string, CalculationAggregate>>();
    for (const row of rows ?? []) {
        const alias = row.alias || row.calculation || '';
        if (!alias) {
            continue;
        }
        const map = new Map<string, CalculationAggregate>();
        for (const agg of row.aggregates ?? []) {
            map.set(groupKey(agg.groups), agg);
        }
        out.set(alias, map);
    }
    return out;
}

export function waitHintOf(wallP95: number | undefined, cpuP50: number | undefined): WaitHint {
    if (wallP95 == null || cpuP50 == null || wallP95 <= 0) {
        return 'mixed';
    }
    if (cpuP50 >= wallP95 * 0.6) {
        return 'cpu';
    }
    if (wallP95 >= cpuP50 * 3) {
        return 'io';
    }
    return 'mixed';
}

export function compareHintOf(
    current: number | undefined,
    previous: number | undefined,
    floorMs: number,
): CompareHint {
    if (current == null || previous == null || previous <= 0) {
        return current != null && current >= floorMs ? 'chronic' : 'unknown';
    }
    if (current >= previous * 1.3 && current >= floorMs) {
        return 'regression';
    }
    if (current >= floorMs && previous >= floorMs) {
        return 'chronic';
    }
    if (current < previous * 0.8) {
        return 'improved';
    }
    return 'unknown';
}

export function cellsFromCalculations(input: {
    calculations?: CalculationResult[];
    compare?: CalculationResult[];
    window: { from: string; to: string };
    scriptKey?: string;
    pathKey?: string;
    floorMs?: number;
}): MetricCell[] {
    const scriptKey = input.scriptKey ?? DEFAULT_SCRIPT_KEY;
    const pathKey = input.pathKey ?? DEFAULT_PATH_KEY;
    const floor = input.floorMs ?? 800;
    const current = indexCalcs(input.calculations);
    const previous = indexCalcs(input.compare);
    const nMap = current.get('n');
    const p95Map = current.get('wall_p95');
    const maxMap = current.get('wall_max');
    const cpuMap = current.get('cpu_p50');
    const prevP95 = previous.get('wall_p95');
    const keys = new Set<string>([...(nMap?.keys() ?? []), ...(p95Map?.keys() ?? [])]);
    const cells: MetricCell[] = [];
    for (const key of keys) {
        const groups = nMap?.get(key)?.groups ?? p95Map?.get(key)?.groups;
        const script = dim(groups, scriptKey);
        if (!script) {
            continue;
        }
        const path = dim(groups, pathKey);
        const n = Number(nMap?.get(key)?.value ?? nMap?.get(key)?.count ?? 0);
        const p95 = p95Map?.get(key)?.value;
        const max = maxMap?.get(key)?.value;
        const cpuP50 = cpuMap?.get(key)?.value;
        const prev = prevP95?.get(key)?.value;
        cells.push({
            source: 'workers_observability',
            name: 'wall_time_ms',
            dims: { script, ...(path ? { path } : {}) },
            window: input.window,
            stats: {
                n,
                ...(p95 != null ? { p95 } : {}),
                ...(max != null ? { max } : {}),
                ...(cpuP50 != null ? { cpuP50 } : {}),
            },
            waitHint: waitHintOf(p95, cpuP50),
            fingerprint: `opt:${script}:${path || '-'}`,
            compare: compareHintOf(p95, prev, floor),
        });
    }
    cells.sort((a, b) => (b.stats.p95 ?? 0) - (a.stats.p95 ?? 0));
    return cells;
}

export interface ErrorBurstGroup {
    script: string;
    message: string;
    count: number;
}

export function groupsFromCountCalculation(
    calculations: CalculationResult[] | undefined,
    input?: { scriptKey?: string; messageKey?: string },
): ErrorBurstGroup[] {
    const scriptKey = input?.scriptKey ?? DEFAULT_SCRIPT_KEY;
    const messageKey = input?.messageKey ?? DEFAULT_MESSAGE_KEY;
    const nMap = indexCalcs(calculations).get('n');
    const groups: ErrorBurstGroup[] = [];
    for (const agg of nMap?.values() ?? []) {
        const script = dim(agg.groups, scriptKey);
        const message = dim(agg.groups, messageKey);
        if (!script) {
            continue;
        }
        groups.push({
            script,
            message,
            count: Number(agg.value ?? agg.count ?? 0),
        });
    }
    groups.sort((a, b) => b.count - a.count);
    return groups;
}

/** 从 traces / invocations 响应里抽 invocation / request id（平台字段不固定） */
export function invocationIdsFromTelemetry(result: unknown, limit: number): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const walk = (node: unknown): void => {
        if (ids.length >= limit || node == null) {
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                walk(item);
            }
            return;
        }
        if (typeof node !== 'object') {
            return;
        }
        const rec = node as Record<string, unknown>;
        for (const key of ['invocationId', 'requestId', 'traceId']) {
            const value = rec[key];
            if (typeof value === 'string' && value.trim() && !seen.has(value)) {
                seen.add(value);
                ids.push(value.trim());
                if (ids.length >= limit) {
                    return;
                }
            }
        }
        for (const value of Object.values(rec)) {
            walk(value);
        }
    };
    walk(result);
    return ids;
}
