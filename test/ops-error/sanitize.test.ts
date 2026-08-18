import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from '../../src/ops-error/sanitize.js';

describe('sanitizeForLog', () => {
    it('redacts sensitive keys', () => {
        expect(
            sanitizeForLog({
                ruleId: 'r1',
                subject: 'secret subject',
                token: 'abc',
            }),
        ).toEqual({
            ruleId: 'r1',
            subject: '[redacted]',
            token: '[redacted]',
        });
    });
});
