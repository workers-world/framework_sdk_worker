import { describe, expect, it } from 'vitest';
import { linkifyPlainTextEmail } from '../../src/email/linkify-plain-text.js';
import {
    estimateBase64Length,
    estimateEmailMessageBytes,
    parseEmailMaxMessageBytes,
} from '../../src/email/message-size.js';
import { extractEmailAddress, isAllowedSender } from '../../src/email/sender-allowlist.js';

describe('sender-allowlist extras', () => {
    it('handles blank, unmatched brackets, and non-email mailbox', () => {
        expect(extractEmailAddress(undefined)).toBe('');
        expect(extractEmailAddress('   ')).toBe('');
        expect(extractEmailAddress('Name > leftover')).toBe('');
        expect(extractEmailAddress('<not-an-email>')).toBe('');
        expect(extractEmailAddress('not email')).toBe('');
        expect(isAllowedSender('a@b.com', 'a@b.com')).toBe(true);
        expect(isAllowedSender('a@b.com', 'other@b.com')).toBe(false);
    });
});

describe('linkify / message-size extras', () => {
    it('strips trailing punctuation from URLs', () => {
        const html = linkifyPlainTextEmail('see https://example.com/a).');
        expect(html).toContain('href="https://example.com/a"');
        expect(html).toContain(').');
    });

    it('counts html attachments and parses env bytes', () => {
        expect(
            estimateEmailMessageBytes(undefined, '<p>x</p>', [{ contentBase64: 'abcd' }]),
        ).toBeGreaterThan(2048);
        expect(parseEmailMaxMessageBytes(undefined)).toBe(25 * 1024 * 1024);
        expect(parseEmailMaxMessageBytes('  ')).toBe(25 * 1024 * 1024);
        expect(parseEmailMaxMessageBytes('0')).toBe(25 * 1024 * 1024);
        expect(parseEmailMaxMessageBytes('nope')).toBe(25 * 1024 * 1024);
        expect(parseEmailMaxMessageBytes('100', 1)).toBe(100);
        expect(estimateBase64Length(3)).toBe(4);
        expect(estimateBase64Length(4)).toBe(8);
    });
});
