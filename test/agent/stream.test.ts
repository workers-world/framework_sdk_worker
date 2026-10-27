import { describe, expect, it } from 'vitest';
import { mapCursorStreamEvent } from '../../src/agent/stream.js';

describe('mapCursorStreamEvent', () => {
    it('maps assistant to message event', () => {
        const ev = mapCursorStreamEvent({ type: 'assistant', text: 'hello', id: 'e1' });
        expect(ev.eventType).toBe('message');
        expect(ev.streamEventId).toBe('e1');
        expect(ev.payload).toMatchObject({ role: 'assistant', text: 'hello' });
    });

    it('maps done to meta', () => {
        const ev = mapCursorStreamEvent({ type: 'done' });
        expect(ev.eventType).toBe('meta');
        expect(ev.payload).toEqual({ kind: 'done' });
    });
});
