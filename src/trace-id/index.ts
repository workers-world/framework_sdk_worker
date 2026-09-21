/**
 * W3C Trace Context 身份（https://www.w3.org/TR/trace-context-1/）。
 *
 * trace-id（32 hex）是整段故事，span-id（16 hex）是其中一步。两者都不编码领域、
 * 日期或业务号。人读用资源流水号，或 formatTraceRef 仅作展示。
 * 规范：docs/requirement/系统踪迹.md §4。
 */

export const TRACE_DOMAINS = [
    'desk',
    'quality',
    'sch1',
    'intake',
    'notify',
    'rss',
    'advisor',
    'orch',
    'cfg',
] as const;

export type TraceDomain = (typeof TRACE_DOMAINS)[number];

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const TRACE_REF_HEX_LEN = 16;

export class InvalidTraceIdError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidTraceIdError';
    }
}

export type ParsedTraceparent = {
    version: string;
    traceId: string;
    spanId: string;
    flags: string;
};

function randomHex(byteLen: number): string {
    const buf = new Uint8Array(byteLen);
    crypto.getRandomValues(buf);
    let out = '';
    for (const b of buf) {
        out += b.toString(16).padStart(2, '0');
    }
    return out;
}

function mintNonZero(byteLen: number): string {
    for (let i = 0; i < 4; i++) {
        const hex = randomHex(byteLen);
        if (!/^0+$/.test(hex)) {
            return hex;
        }
    }
    throw new InvalidTraceIdError('无法生成非零 id');
}

export function isTraceDomain(value: string): value is TraceDomain {
    return (TRACE_DOMAINS as readonly string[]).includes(value);
}

export function assertTraceDomain(domain: string): TraceDomain {
    if (!isTraceDomain(domain)) {
        throw new InvalidTraceIdError(`trace domain 非法: ${domain}`);
    }
    return domain;
}

/** 收 32 hex 或带连字符 UUID；全 0 与其它形状抛错。 */
export function normalizeTraceId(raw: string): string {
    const s = raw.trim().toLowerCase();
    const hex = UUID_RE.test(s) ? s.replaceAll('-', '') : s;
    if (!HEX32.test(hex) || /^0+$/.test(hex)) {
        throw new InvalidTraceIdError(`traceId 非法: ${raw}`);
    }
    return hex;
}

export function normalizeSpanId(raw: string): string {
    const s = raw.trim().toLowerCase();
    if (!HEX16.test(s) || /^0+$/.test(s)) {
        throw new InvalidTraceIdError(`spanId 非法: ${raw}`);
    }
    return s;
}

export function isTraceId(value: string): boolean {
    try {
        normalizeTraceId(value);
        return true;
    } catch {
        return false;
    }
}

export function isSpanId(value: string): boolean {
    try {
        normalizeSpanId(value);
        return true;
    } catch {
        return false;
    }
}

/** W3C trace-id：16 字节小写 hex。 */
export function mintTraceId(): string {
    return mintNonZero(16);
}

/** W3C span-id：8 字节小写 hex。从属于调用方持有的 traceId，不把父 id 编进字符串。 */
export function mintSpanId(): string {
    return mintNonZero(8);
}

export function formatTraceparent(traceId: string, spanId: string, flags = '01'): string {
    const trace = normalizeTraceId(traceId);
    const span = normalizeSpanId(spanId);
    const flag = flags.trim().toLowerCase();
    if (!/^[0-9a-f]{2}$/.test(flag)) {
        throw new InvalidTraceIdError(`trace flags 非法: ${flags}`);
    }
    return `00-${trace}-${span}-${flag}`;
}

export function parseTraceparent(raw: string): ParsedTraceparent {
    const match = TRACEPARENT_RE.exec(raw.trim().toLowerCase());
    if (!match) {
        throw new InvalidTraceIdError(`traceparent 非法: ${raw}`);
    }
    const version = match[1] ?? '';
    const traceId = match[2] ?? '';
    const spanId = match[3] ?? '';
    const flags = match[4] ?? '';
    if (version === 'ff' || version !== '00' || /^0+$/.test(traceId) || /^0+$/.test(spanId)) {
        throw new InvalidTraceIdError(`traceparent 非法: ${raw}`);
    }
    return { version, traceId, spanId, flags };
}

/** 展示标签，不是存储主键。例：`desk 5b8aa5a2d2c872e8`。 */
export function formatTraceRef(input: { domain: string; traceId: string }): string {
    const domain = assertTraceDomain(input.domain);
    const traceId = normalizeTraceId(input.traceId);
    return `${domain} ${traceId.slice(0, TRACE_REF_HEX_LEN)}`;
}

/** CloudEvents / W3C tracestate 短 vendor 键。无 PII。 */
export function formatTracestate(domain: string): string {
    return `ww=${assertTraceDomain(domain)}`;
}
