/**
 * Service Binding binding：fetch request/response body = WorkerIoEnvelope。
 */
import type { WorkerIoEnvelope } from '../envelope.js';
import { decodeWorkerIoEnvelope, encodeWorkerIoEnvelope } from '../serde.js';
import { CLOUDEVENTS_CONTENT_TYPE } from './http.js';

export type FetcherLike = {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export async function workerIoBindingFetch(
    svc: FetcherLike,
    url: string,
    envelope: WorkerIoEnvelope,
    init?: Omit<RequestInit, 'body'>,
): Promise<WorkerIoEnvelope> {
    const method = (init?.method ?? 'POST').toUpperCase();
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', CLOUDEVENTS_CONTENT_TYPE);
    }
    const res = await svc.fetch(url, {
        ...init,
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : encodeWorkerIoEnvelope(envelope),
    });
    const text = await res.text();
    if (!text.trim()) {
        throw new Error(`binding response empty (HTTP ${res.status})`);
    }
    return decodeWorkerIoEnvelope(text);
}

export async function workerIoBindingGet(
    svc: FetcherLike,
    url: string,
    init?: Omit<RequestInit, 'body' | 'method'>,
): Promise<WorkerIoEnvelope> {
    const res = await svc.fetch(url, { ...init, method: 'GET' });
    const text = await res.text();
    return decodeWorkerIoEnvelope(text);
}
