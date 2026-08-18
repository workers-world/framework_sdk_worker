import { describe, expect, it } from 'vitest';
import { describeVideoLink, isVideoUrl } from '../../src/url/video-link.js';

describe('isVideoUrl', () => {
    it('detects known video hosts', () => {
        expect(isVideoUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
        expect(isVideoUrl('https://youtu.be/abc')).toBe(true);
        expect(isVideoUrl('https://www.bilibili.com/video/BV1xx')).toBe(true);
        expect(isVideoUrl('https://b23.tv/xxxxx')).toBe(true);
        expect(isVideoUrl('https://vimeo.com/123')).toBe(true);
    });

    it('detects direct video file URLs', () => {
        expect(isVideoUrl('https://cdn.example.com/clip.mp4')).toBe(true);
        expect(isVideoUrl('https://cdn.example.com/stream.m3u8?token=1')).toBe(true);
    });

    it('rejects normal news pages', () => {
        expect(isVideoUrl('https://finance.eastmoney.com/a/202607311234.html')).toBe(false);
        expect(isVideoUrl('https://finance.yahoo.com/news/foo')).toBe(false);
        expect(isVideoUrl('https://example.com/article')).toBe(false);
    });

    it('rejects empty or invalid', () => {
        expect(isVideoUrl('')).toBe(false);
        expect(isVideoUrl('not-a-url')).toBe(false);
        expect(isVideoUrl('ftp://youtube.com/watch?v=1')).toBe(false);
    });
});

describe('describeVideoLink', () => {
    it('includes hostname', () => {
        expect(describeVideoLink('https://www.youtube.com/watch?v=1')).toContain('youtube.com');
        expect(describeVideoLink('https://www.youtube.com/watch?v=1')).toContain('未抓取正文');
    });
});
