import { describe, expect, it } from 'vitest';
import {
    EMAIL_MESSAGE_SIZE_OVERHEAD_BYTES,
    estimateEmailMessageBytes,
    parseEmailMaxMessageBytes,
} from '../../src/email/message-size.js';

describe('email/message-size', () => {
    it('estimateEmailMessageBytes 含正文与 base64 附件', () => {
        const body = 'hello';
        const attachments = [{ contentBase64: 'abcd' }];
        const total = estimateEmailMessageBytes(body, undefined, attachments);
        expect(total).toBe(
            EMAIL_MESSAGE_SIZE_OVERHEAD_BYTES + new TextEncoder().encode(body).length + 4,
        );
    });

    it('parseEmailMaxMessageBytes 解析 env', () => {
        expect(parseEmailMaxMessageBytes('1048576', 25)).toBe(1048576);
        expect(parseEmailMaxMessageBytes('', 25)).toBe(25);
        expect(parseEmailMaxMessageBytes('bad', 25)).toBe(25);
    });
});
