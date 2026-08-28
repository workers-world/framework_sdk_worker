import { describe, expect, it } from 'vitest';
import { DRAFT_REJECT_REASONS, isDraftRejectReason } from '../../src/desk/reject-reason.js';
import { DEFAULT_FALLBACK_SPEC } from '../../src/mcp/fallback-spec.js';

describe('draft reject reason', () => {
    it('accepts only the closed enum', () => {
        expect(DRAFT_REJECT_REASONS).toContain('wrong_side');
        expect(isDraftRejectReason('wrong_side')).toBe(true);
        expect(isDraftRejectReason('nope')).toBe(false);
        expect(isDraftRejectReason(1)).toBe(false);
    });

    it('keeps MCP fallback PATCH enum in lockstep', () => {
        const patch = DEFAULT_FALLBACK_SPEC.paths['/v1/drafts/{id}']?.patch as {
            requestBody: {
                content: {
                    'application/json': {
                        schema: { properties: { rejectReason: { enum: string[] } } };
                    };
                };
            };
        };
        expect(
            patch.requestBody.content['application/json'].schema.properties.rejectReason.enum,
        ).toEqual([...DRAFT_REJECT_REASONS]);
    });
});
