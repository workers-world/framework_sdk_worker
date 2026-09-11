import { describe, expect, it, vi } from 'vitest';
import { mapCursorSseFrame, streamCursorAgentRun } from '../../src/cursor/cloud-agent.js';
import { parseSseBuffer } from '../../src/cursor/sse-parser.js';

const EXAMPLE_STREAM = `event: status
data: {"runId":"run-1","status":"RUNNING"}

id: 1713033000000-0
event: assistant
data: {"text":"I'll update the README now."}

id: 1713033005000-0
event: tool_call
data: {"callId":"call-1","name":"read_file","status":"running","args":{"path":"README.md"}}

id: 1713033010000-0
event: result
data: {"runId":"run-1","status":"FINISHED","text":"Done.","durationMs":123,"git":{"branches":[{"prUrl":"https://github.com/o/r/pull/1"}]}}

id: 1713033010000-1
event: done
data: {}

`;

describe('parseSseBuffer', () => {
    it('parses multi-event SSE text', () => {
        const { frames, remainder } = parseSseBuffer(EXAMPLE_STREAM);
        expect(remainder).toBe('');
        expect(frames).toHaveLength(5);
        expect(frames[0]).toMatchObject({ event: 'status' });
        expect(frames[1]).toMatchObject({ id: '1713033000000-0', event: 'assistant' });
    });

    it('keeps incomplete trailing line in remainder', () => {
        const partial = 'id: 1\nevent: assistant\ndata: {"te';
        const { frames, remainder } = parseSseBuffer(partial);
        expect(frames).toHaveLength(0);
        expect(remainder).toBe('data: {"te');
    });
});

describe('mapCursorSseFrame', () => {
    it('maps result with prUrl', () => {
        const mapped = mapCursorSseFrame({
            id: 'x',
            event: 'result',
            data: '{"status":"FINISHED","git":{"branches":[{"prUrl":"https://github.com/o/r/pull/2"}]}}',
        });
        expect(mapped).toMatchObject({
            type: 'result',
            status: 'FINISHED',
            prUrl: 'https://github.com/o/r/pull/2',
        });
    });

    it('ignores heartbeat', () => {
        expect(mapCursorSseFrame({ event: 'heartbeat', data: '{}' })).toBeNull();
    });
});

describe('streamCursorAgentRun', () => {
    it('yields mapped events from SSE body', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(EXAMPLE_STREAM));
                controller.close();
            },
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(stream, { status: 200 })),
        );

        const events: string[] = [];
        for await (const ev of streamCursorAgentRun('key', { agentId: 'a', runId: 'r' })) {
            events.push(ev.type);
        }
        expect(events).toEqual(['status', 'assistant', 'tool_call', 'result', 'done']);
        vi.unstubAllGlobals();
    });
});
