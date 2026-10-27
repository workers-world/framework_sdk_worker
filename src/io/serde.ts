/**
 * WorkerIoEnvelope JSON 编解码与校验。
 */
import { isWorkerIoEnvelope, WORKER_IO_SPECVERSION, type WorkerIoEnvelope } from './envelope.js';

export class WorkerIoDecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkerIoDecodeError';
    }
}

/** 单行 JSON（SSE data / Queue body） */
export function encodeWorkerIoEnvelope(e: WorkerIoEnvelope): string {
    return JSON.stringify(e);
}

export function decodeWorkerIoEnvelope(json: string): WorkerIoEnvelope {
    let raw: unknown;
    try {
        raw = JSON.parse(json) as unknown;
    } catch {
        throw new WorkerIoDecodeError('invalid JSON');
    }
    return assertWorkerIoEnvelope(raw);
}

export function assertWorkerIoEnvelope(raw: unknown): WorkerIoEnvelope {
    if (!isWorkerIoEnvelope(raw)) {
        throw new WorkerIoDecodeError(
            `expected CloudEvents ${WORKER_IO_SPECVERSION} WorkerIoEnvelope`,
        );
    }
    return raw;
}

export function tryDecodeWorkerIoEnvelope(json: string): WorkerIoEnvelope | null {
    try {
        return decodeWorkerIoEnvelope(json);
    } catch {
        return null;
    }
}
