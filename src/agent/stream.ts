import type { CursorStreamEvent } from '../cursor/cloud-agent.js';
import type { AgentStreamEvent } from './types.js';

/** Cursor SSE 事件 → neutral AgentStreamEvent（sch1 D1 写入用） */
export function mapCursorStreamEvent(ev: CursorStreamEvent & { id?: string }): AgentStreamEvent {
    const streamEventId = ev.id ?? null;
    switch (ev.type) {
        case 'status':
            return {
                eventType: 'status',
                streamEventId,
                payload: { status: ev.status, runId: ev.runId },
            };
        case 'assistant':
            return {
                eventType: 'message',
                streamEventId,
                payload: { role: 'assistant', text: ev.text },
            };
        case 'thinking':
            return {
                eventType: 'message',
                streamEventId,
                payload: { role: 'thinking', text: ev.text },
            };
        case 'tool_call':
            return {
                eventType: 'tool_call',
                streamEventId,
                payload: {
                    callId: ev.callId,
                    name: ev.name,
                    status: ev.status,
                    args: ev.args,
                    result: ev.result,
                    truncated: ev.truncated,
                },
            };
        case 'result':
            return {
                eventType: 'result',
                streamEventId,
                payload: {
                    status: ev.status,
                    runId: ev.runId,
                    text: ev.text,
                    durationMs: ev.durationMs,
                    prUrl: ev.prUrl,
                },
            };
        case 'error':
            return {
                eventType: 'error',
                streamEventId,
                payload: { code: ev.code, message: ev.message },
            };
        case 'done':
            return {
                eventType: 'meta',
                streamEventId,
                payload: { kind: 'done' },
            };
        default:
            return {
                eventType: 'meta',
                streamEventId,
                payload: { kind: 'unknown', rawType: (ev as { type?: string }).type },
            };
    }
}

/** sch1 AgentEventInput 别名（历史命名） */
export type AgentEventType = AgentStreamEvent['eventType'];
export type AgentEventInput = AgentStreamEvent;
