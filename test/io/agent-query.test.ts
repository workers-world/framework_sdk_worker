import { describe, expect, it } from 'vitest';
import { wantsAgentWorkerIo } from '../../src/io/agent-query.js';

describe('wantsAgentWorkerIo', () => {
    it('accepts 1/true/yes', () => {
        expect(wantsAgentWorkerIo('1')).toBe(true);
        expect(wantsAgentWorkerIo('true')).toBe(true);
        expect(wantsAgentWorkerIo('YES')).toBe(true);
    });

    it('rejects other values', () => {
        expect(wantsAgentWorkerIo(undefined)).toBe(false);
        expect(wantsAgentWorkerIo('0')).toBe(false);
        expect(wantsAgentWorkerIo('')).toBe(false);
    });
});
