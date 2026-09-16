/**
 * HTTP binding：同步请求/响应 body = WorkerIoEnvelope JSON。
 */
import type { WorkerIoEnvelope } from '../envelope.js';
import { decodeWorkerIoEnvelope, encodeWorkerIoEnvelope } from '../serde.js';

export const CLOUDEVENTS_CONTENT_TYPE = 'application/cloudevents+json';
export const JSON_CONTENT_TYPE = 'application/json';

export function workerIoToHttpResponse(
    envelope: WorkerIoEnvelope,
    status = 200,
    opts?: { contentType?: string },
): Response {
    const contentType = opts?.contentType ?? CLOUDEVENTS_CONTENT_TYPE;
    return new Response(encodeWorkerIoEnvelope(envelope), {
        status,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        },
    });
}

export async function workerIoFromHttpRequest(req: Request): Promise<WorkerIoEnvelope> {
    const text = await req.text();
    return decodeWorkerIoEnvelope(text);
}

export async function workerIoFromHttpResponse(res: Response): Promise<WorkerIoEnvelope> {
    const text = await res.text();
    return decodeWorkerIoEnvelope(text);
}
