import { describe, expect, it } from 'vitest';
import { sanitizeForLog } from '../../src/ops-error/sanitize.js';

describe('sanitizeForLog', () => {
    it('redacts sensitive keys (historical whitelist still holds)', () => {
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

    it('redacts compound variant keys via token segmentation', () => {
        expect(
            sanitizeForLog({
                authToken: 'a',
                userEmail: 'u@example.com',
                apiKeyId: 'id',
                rawBody: 'raw',
                notifyTo: 'ops@example.com',
                alert_to: 'ops@example.com',
                'X-Auth': 'b',
                originalHtml: '<p/>',
            }),
        ).toEqual({
            authToken: '[redacted]',
            userEmail: '[redacted]',
            apiKeyId: '[redacted]',
            rawBody: '[redacted]',
            notifyTo: '[redacted]',
            alert_to: '[redacted]',
            'X-Auth': '[redacted]',
            originalHtml: '[redacted]',
        });
    });

    it('redacts private key / signing key / access key variants', () => {
        // 回归：GitHub App 私钥、key1 签名密钥、云厂商 AccessKey 曾漏脱敏
        expect(
            sanitizeForLog({
                githubPrivateKey: 'pem',
                privateKeyPem: 'pem',
                signingKey: 'sk',
                accessKeyId: 'AKIA...',
                GITHUB_PRIVATE_KEY_PLANNING: 'pem',
            }),
        ).toEqual({
            githubPrivateKey: '[redacted]',
            privateKeyPem: '[redacted]',
            signingKey: '[redacted]',
            accessKeyId: '[redacted]',
            GITHUB_PRIVATE_KEY_PLANNING: '[redacted]',
        });
    });

    it('does not redact lookalike keys that are not sensitive', () => {
        const out = sanitizeForLog({
            ruleId: 'r1',
            attempts: 3,
            topic: 't',
            total: 10,
            monkey: 'm',
            context: { ok: true },
        });
        expect(out).toEqual({
            ruleId: 'r1',
            attempts: 3,
            topic: 't',
            total: 10,
            monkey: 'm',
            context: { ok: true },
        });
    });

    it('keeps error/message readable for ops debugging', () => {
        expect(sanitizeForLog({ error: 'boom', message: 'stack detail' })).toEqual({
            error: 'boom',
            message: 'stack detail',
        });
    });

    it('recurses into nested objects and arrays of objects', () => {
        expect(
            sanitizeForLog({
                items: [{ id: 1, token: 'leak' }, 'plain'],
                nested: { deep: { auth_token: 'leak' } },
            }),
        ).toEqual({
            items: [{ id: 1, token: '[redacted]' }, 'plain'],
            nested: { deep: { auth_token: '[redacted]' } },
        });
    });

    it('passes through non-plain objects untouched (Date, class instances)', () => {
        const date = new Date('2026-08-30T00:00:00Z');
        class Custom {
            token = 'x';
        }
        const custom = new Custom();
        const out = sanitizeForLog({ at: date, thing: custom });
        expect(out.at).toBe(date);
        expect(out.thing).toBe(custom);
    });

    it('handles null values and empty input', () => {
        expect(sanitizeForLog({ a: null })).toEqual({ a: null });
        expect(sanitizeForLog()).toEqual({});
    });
});
