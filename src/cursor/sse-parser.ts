/** SSE 帧（event / data / id 行组合） */
export interface SseFrame {
    id?: string;
    event: string;
    data: string;
}

/**
 * 将 SSE 文本块解析为事件帧（用于单测与流式解码共用）。
 * 支持多事件、跨块边界由调用方拼接未完成行。
 */
export function parseSseBuffer(buffer: string): { frames: SseFrame[]; remainder: string } {
    const normalized = buffer.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const complete = normalized.endsWith('\n');
    const lineCount = complete ? lines.length : lines.length - 1;
    const remainder = complete ? '' : (lines[lines.length - 1] ?? '');

    const frames: SseFrame[] = [];
    let currentEvent = 'message';
    let currentId: string | undefined;
    const dataLines: string[] = [];

    const flush = () => {
        if (dataLines.length === 0 && currentEvent === 'message' && !currentId) {
            return;
        }
        frames.push({
            id: currentId,
            event: currentEvent,
            data: dataLines.join('\n'),
        });
        dataLines.length = 0;
        currentEvent = 'message';
        currentId = undefined;
    };

    for (let i = 0; i < lineCount; i++) {
        const line = lines[i] ?? '';
        if (line === '') {
            flush();
            continue;
        }
        if (line.startsWith(':')) {
            continue;
        }
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') {
            currentEvent = value || 'message';
        } else if (field === 'id') {
            currentId = value || undefined;
        } else if (field === 'data') {
            dataLines.push(value);
        }
    }

    return { frames, remainder };
}

/** 从 ReadableStream 增量读取并产出 SSE 帧 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseBuffer(buffer);
            buffer = parsed.remainder;
            for (const frame of parsed.frames) {
                yield frame;
            }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
            const parsed = parseSseBuffer(`${buffer}\n`);
            for (const frame of parsed.frames) {
                yield frame;
            }
        }
    } finally {
        reader.releaseLock();
    }
}
