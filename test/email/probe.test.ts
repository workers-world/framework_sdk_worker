import { describe, expect, it } from 'vitest';
import { buildEmailProbe, subjectFromMessage } from '../../src/email/probe.js';

function makeMessage(
    from: string,
    to: string,
    headers: Record<string, string | null>,
): ForwardableEmailMessage {
    return {
        from,
        to,
        headers: {
            get(name: string) {
                const key = name.toLowerCase();
                const found = Object.entries(headers).find(([k]) => k.toLowerCase() === key);
                return found ? found[1] : null;
            },
        },
    } as unknown as ForwardableEmailMessage;
}

describe('buildEmailProbe', () => {
    it('decodes MIME subject and copies from/to/message-id', () => {
        const probe = buildEmailProbe(
            makeMessage('a@example.com', 'b@example.com', {
                subject: '=?UTF-8?B?5rWL6K+V?=',
                'message-id': ' <id-1> ',
            }),
        );
        expect(probe.from).toBe('a@example.com');
        expect(probe.to).toBe('b@example.com');
        expect(probe.subject).toBe('测试');
        expect(probe.messageId).toBe('<id-1>');
        expect(probe.text).toBe('');
        expect(probe.html).toBe('');
    });

    it('falls back to (no subject) and synthesizes messageId', () => {
        const probe = buildEmailProbe(
            makeMessage('sender@x.com', 'to@x.com', { subject: '  ', 'message-id': null }),
        );
        expect(probe.subject).toBe('(no subject)');
        expect(probe.messageId).toBe('sender@x.com-(no subject)');
    });

    it('keeps raw subject when MIME decode yields empty', () => {
        const probe = buildEmailProbe(makeMessage('from@x', 'to@x', { subject: 'plain subject' }));
        expect(probe.subject).toBe('plain subject');
    });
});

describe('subjectFromMessage', () => {
    it('mirrors probe subject fallbacks', () => {
        expect(subjectFromMessage(makeMessage('a', 'b', { subject: '=?UTF-8?Q?Hello?=  ' }))).toBe(
            'Hello',
        );
        expect(subjectFromMessage(makeMessage('a', 'b', { subject: '' }))).toBe('(no subject)');
        expect(subjectFromMessage(makeMessage('a', 'b', {}))).toBe('(no subject)');
    });
});
