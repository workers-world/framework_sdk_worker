/**
 * W3C traceparent 传播 helper（Queue / Service Binding 子请求）。
 * 身份由 trace-id 模块铸造：32 hex trace + 16 hex span，不另造前缀语法。
 */
import { formatTraceparent, mintSpanId, mintTraceId } from '../trace-id.js';

const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';

/** 生成 W3C traceparent（version 00，已采样） */
export function createTraceparent(): string {
    return formatTraceparent(mintTraceId(), mintSpanId());
}

export function injectTraceparent(headers: HeadersInit | Headers, traceparent: string): Headers {
    const h = headers instanceof Headers ? new Headers(headers) : new Headers(headers);
    h.set(TRACEPARENT_HEADER, traceparent);
    return h;
}

export function readTraceparent(request: Request): string | undefined {
    const v = request.headers.get(TRACEPARENT_HEADER)?.trim();
    return v || undefined;
}

export function readCfRequestId(response: Response): string | undefined {
    const v = response.headers.get('cf-ray')?.trim();
    return v || undefined;
}

/** Q_DESK_SIGNAL：lineageId 与 traceparent 共用同一个 W3C trace-id */
export function createDeskSignalTraceBundle(): { traceId: string; traceparent: string } {
    const traceId = mintTraceId();
    return {
        traceId,
        traceparent: formatTraceparent(traceId, mintSpanId()),
    };
}

export { TRACEPARENT_HEADER, TRACESTATE_HEADER };
