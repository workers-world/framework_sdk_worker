/**
 * Queue binding：message.body = WorkerIoEnvelope JSON 字符串。
 */
import type { WorkerIoEnvelope } from '../envelope.js';
import { decodeWorkerIoEnvelope, encodeWorkerIoEnvelope } from '../serde.js';

export function encodeWorkerIoQueueBody(envelope: WorkerIoEnvelope): string {
    return encodeWorkerIoEnvelope(envelope);
}

export function decodeWorkerIoQueueBody(body: unknown): WorkerIoEnvelope {
    if (typeof body === 'string') {
        return decodeWorkerIoEnvelope(body);
    }
    if (body != null && typeof body === 'object') {
        // 部分 consumer 已 JSON.parse
        return decodeWorkerIoEnvelope(JSON.stringify(body));
    }
    throw new Error('queue body must be string or object');
}

/** 发送到 CF Queue 时用的 body（字符串） */
export function workerIoQueueSendBody(envelope: WorkerIoEnvelope): string {
    return encodeWorkerIoQueueBody(envelope);
}
