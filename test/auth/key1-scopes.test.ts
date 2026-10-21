import { describe, expect, it } from 'vitest';
import {
    hasAllScopes,
    isKey1Scope,
    KEY1_SCOPE_PLANNING_READ,
    KEY1_SCOPE_SCH1_READ,
    KEY1_SCOPE_SCH1_WRITE,
    KEY1_SCOPES,
} from '../../src/auth/key1-scopes.js';

describe('key1-scopes', () => {
    it('includes sch1.read/write', () => {
        expect(KEY1_SCOPES).toContain(KEY1_SCOPE_SCH1_READ);
        expect(KEY1_SCOPES).toContain(KEY1_SCOPE_SCH1_WRITE);
        expect(isKey1Scope('sch1.read')).toBe(true);
        expect(isKey1Scope('sch1.write')).toBe(true);
        expect(isKey1Scope('intake.read')).toBe(false);
    });

    it('hasAllScopes requires every scope', () => {
        expect(
            hasAllScopes([KEY1_SCOPE_SCH1_READ, KEY1_SCOPE_SCH1_WRITE], [KEY1_SCOPE_SCH1_READ]),
        ).toBe(true);
        expect(hasAllScopes([KEY1_SCOPE_PLANNING_READ], [KEY1_SCOPE_SCH1_READ])).toBe(false);
    });
});
