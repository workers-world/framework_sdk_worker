import { describe, expect, it } from 'vitest';
import { formatAgentModelRef, parseAgentModelRef } from '../../src/agent/model-ref.js';

describe('parseAgentModelRef', () => {
    it('parses composite provider:modelId', () => {
        expect(parseAgentModelRef('cursor:composer-2.5')).toEqual({
            provider: 'cursor',
            modelId: 'composer-2.5',
        });
    });

    it('treats bare id as cursor provider', () => {
        expect(parseAgentModelRef('auto')).toEqual({ provider: 'cursor', modelId: 'auto' });
        expect(parseAgentModelRef('composer-2.5-fast')).toEqual({
            provider: 'cursor',
            modelId: 'composer-2.5-fast',
        });
    });

    it('defaults empty to cursor:auto', () => {
        expect(parseAgentModelRef(null)).toEqual({ provider: 'cursor', modelId: 'auto' });
        expect(parseAgentModelRef('  ')).toEqual({ provider: 'cursor', modelId: 'auto' });
    });
});

describe('formatAgentModelRef', () => {
    it('formats composite string', () => {
        expect(formatAgentModelRef({ provider: 'cursor', modelId: 'auto' })).toBe('cursor:auto');
    });
});
