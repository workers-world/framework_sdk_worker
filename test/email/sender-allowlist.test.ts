import { describe, expect, it } from 'vitest';
import { extractEmailAddress, isAllowedSender } from '../../src/email/sender-allowlist.js';

describe('extractEmailAddress', () => {
    it('parses Name <email> form', () => {
        expect(extractEmailAddress('通知 <noreply@mailworld.uk>')).toBe('noreply@mailworld.uk');
    });

    it('parses bare email', () => {
        expect(extractEmailAddress('noreply@mailworld.uk')).toBe('noreply@mailworld.uk');
    });

    it('uses mailbox inside angle brackets, not display-name text', () => {
        expect(extractEmailAddress('"allowed@example.com" <attacker@evil.example>')).toBe(
            'attacker@evil.example',
        );
    });
});

describe('isAllowedSender', () => {
    const allowlist = 'allowed@example.com,ops@mailworld.uk';

    it('allows listed mailbox in angle-bracket form', () => {
        expect(isAllowedSender(allowlist, 'Ops <ops@mailworld.uk>')).toBe(true);
    });

    it('rejects attacker when allowlisted address appears only in display name', () => {
        expect(isAllowedSender(allowlist, '"allowed@example.com" <attacker@evil.example>')).toBe(
            false,
        );
    });

    it('rejects when allowlist is empty (fail-closed)', () => {
        expect(isAllowedSender(undefined, 'ops@mailworld.uk')).toBe(false);
        expect(isAllowedSender('  ', 'ops@mailworld.uk')).toBe(false);
    });
});
