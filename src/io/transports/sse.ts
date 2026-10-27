/**
 * SSE binding：每帧 data: = WorkerIoEnvelope JSON；event 固定为 stream。
 */
import { parseSseBuffer, readSseStream, type SseFrame } from '../../cursor/sse-parser.js';
import type { WorkerIoEnvelope } from '../envelope.js';
import { encodeWorkerIoEnvelope, tryDecodeWorkerIoEnvelope } from '../serde.js';

export const SSE_ADMIN_EVENT_NAME = 'stream' as const;

/** 将信封编码为一条 SSE 帧（含结尾空行） */
export function encodeWorkerIoSseFrame(envelope: WorkerIoEnvelope): string {
    const id = envelope.id;
    const data = encodeWorkerIoEnvelope(envelope);
    return `event: ${SSE_ADMIN_EVENT_NAME}\nid: ${id}\ndata: ${data}\n\n`;
}

export function decodeWorkerIoSseFrame(frame: SseFrame): WorkerIoEnvelope | null {
    if (frame.event !== SSE_ADMIN_EVENT_NAME && frame.event !== 'message') {
        return null;
    }
    return tryDecodeWorkerIoEnvelope(frame.data);
}

/** 客户端：ReadableStream → WorkerIoEnvelope 流 */
export async function* readWorkerIoOverSse(
    body: ReadableStream<Uint8Array>,
): AsyncGenerator<WorkerIoEnvelope> {
    for await (const frame of readSseStream(body)) {
        const env = decodeWorkerIoSseFrame(frame);
        if (env) {
            yield env;
        }
    }
}

export type { SseFrame };
export { parseSseBuffer, readSseStream };
