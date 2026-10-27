/**
 * Quality SLO 打点：写入 Workers Analytics Engine（异常率 / 耗时）。
 * 上游：llm-gateway / desk 热路径。
 * 下游：SQL API `FROM quality_slo`（Grafana 或 deploy-tracker）。
 * 不变量：绑定缺失或 write 抛错则 no-op；不 await；不入 Quality Ops 队列。
 *
 * 列约定（顺序固定，查询用别名）：
 *   index1 = service
 *   blob1  = kind
 *   blob2  = because
 *   blob3  = route
 *   blob4  = caller（调用方标识 `<worker>:<场景>`，可选）
 *   double1 = latency_ms
 *   double2 = ok (1/0)
 *   double3 = extra（tokens / 驳回条数等，可选）
 */
export const QUALITY_SLO_BINDING = 'AE_QUALITY_SLO';
export const QUALITY_SLO_DATASET = 'quality_slo';

/** index 上限 96 bytes（CF limits） */
const INDEX_MAX_BYTES = 96;
const BLOB_MAX_CHARS = 256;

export interface QualitySloDataset {
    writeDataPoint(event?: {
        indexes?: Array<ArrayBuffer | string | null>;
        blobs?: Array<ArrayBuffer | string | null>;
        doubles?: number[];
    }): void;
}

export interface QualitySample {
    service: string;
    kind: string;
    because: string;
    route?: string;
    /** 调用方标识 `<worker>:<场景>`（如 `advisor-worker:advice-cluster`），可选 */
    caller?: string;
    latencyMs: number;
    ok: boolean;
    extra?: number;
}

function clipBytes(value: string, maxBytes: number): string {
    const raw = String(value ?? '');
    const encoded = new TextEncoder().encode(raw);
    if (encoded.length <= maxBytes) {
        return raw;
    }
    return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

function clipChars(value: string, maxChars: number): string {
    const raw = String(value ?? '');
    return raw.length <= maxChars ? raw : raw.slice(0, maxChars);
}

function finiteNonNeg(n: number): number {
    if (!Number.isFinite(n) || n < 0) {
        return 0;
    }
    return n;
}

/**
 * 写入一条 SLO 样本。dataset 缺失（本地 wrangler / 未绑仓）时直接返回。
 */
export function recordQualitySample(
    dataset: QualitySloDataset | undefined | null,
    sample: QualitySample,
): void {
    if (!dataset || typeof dataset.writeDataPoint !== 'function') {
        return;
    }
    try {
        dataset.writeDataPoint({
            indexes: [clipBytes(sample.service, INDEX_MAX_BYTES)],
            blobs: [
                clipChars(sample.kind, BLOB_MAX_CHARS),
                clipChars(sample.because, BLOB_MAX_CHARS),
                clipChars(sample.route ?? '', BLOB_MAX_CHARS),
                clipChars(sample.caller ?? '', BLOB_MAX_CHARS),
            ],
            doubles: [
                finiteNonNeg(sample.latencyMs),
                sample.ok ? 1 : 0,
                finiteNonNeg(sample.extra ?? 0),
            ],
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`quality_slo write failed service=${sample.service} error=${msg}`);
    }
}
