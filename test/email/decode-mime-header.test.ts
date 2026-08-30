import { describe, expect, it } from 'vitest';
import { decodeMimeHeader } from '../../src/email/decode-mime-header.js';

describe('decodeMimeHeader', () => {
    it('returns plain text unchanged (whitespace collapsed)', () => {
        expect(decodeMimeHeader('Plain Subject Here')).toBe('Plain Subject Here');
        expect(decodeMimeHeader('  multi   space  ')).toBe('multi space');
    });

    it('decodes Q-encoded UTF-8', () => {
        expect(decodeMimeHeader('=?utf-8?Q?Hello_=E4=B8=96=E7=95=8C?=')).toBe('Hello 世界');
    });

    it('treats underscore as space in Q encoding', () => {
        expect(decodeMimeHeader('=?utf-8?Q?a_b?=')).toBe('a b');
    });

    it('decodes B-encoded UTF-8', () => {
        // 5LiW55WM → E4B896 E7958C → 世界
        expect(decodeMimeHeader('=?utf-8?B?5LiW55WM?=')).toBe('世界');
        // 5Lit5Zu9 → E4B8AD E59BBD → 中国
        expect(decodeMimeHeader('=?utf-8?B?5Lit5Zu9?=')).toBe('中国');
    });

    it('decodes multiple encoded words in one header', () => {
        expect(decodeMimeHeader('=?utf-8?Q?Part1?= =?utf-8?Q?Part2?=')).toBe('Part1 Part2');
    });

    it('falls back to original on invalid B payload', () => {
        expect(decodeMimeHeader('=?utf-8?B?!!!!?=')).toBe('=?utf-8?B?!!!!?=');
    });

    it('falls back to original on unknown charset', () => {
        expect(decodeMimeHeader('=?x-unknown?Q?abc?=')).toBe('=?x-unknown?Q?abc?=');
    });

    it('keeps literal = when followed by non-hex (no silent zeroing)', () => {
        // 回归：曾 parseInt('=x1' 的 'x1') → NaN → Uint8Array 归 0，静默损坏
        expect(decodeMimeHeader('=?utf-8?Q?a=xb?=')).toBe('a=xb');
        expect(decodeMimeHeader('=?utf-8?Q?=x1b?=')).toBe('=x1b');
        // 末尾孤立 = 保留为字面量
        expect(decodeMimeHeader('=?utf-8?Q?abc=?=')).toBe('abc=');
        // 合法的 =XX 转义仍正常：=41 → 'A'
        expect(decodeMimeHeader('=?utf-8?Q?a=41?=')).toBe('aA');
    });

    it('returns empty for empty input', () => {
        expect(decodeMimeHeader('')).toBe('');
        expect(decodeMimeHeader('   ')).toBe('');
    });
});
