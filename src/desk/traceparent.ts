/**
 * W3C traceparent 传播 helper（Queue / Service Binding 子请求）。
 */

const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';

/** 生成 W3C traceparent（version 00） */
export function createTraceparent(): string {
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return `00-${traceId}-${spanId}-01`;
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

/** Q_DESK_SIGNAL：lineageId（traceId）+ W3C traceparent 同捆生成 */
export function createDeskSignalTraceBundle(): { traceId: string; traceparent: string } {
    const traceId = crypto.randomUUID();
    const hexTrace = traceId.replace(/-/g, '');
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return {
        traceId,
        traceparent: `00-${hexTrace}-${spanId}-01`,
    };
}

export { TRACEPARENT_HEADER, TRACESTATE_HEADER };
