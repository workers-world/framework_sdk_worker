import { describe, expect, it } from 'vitest';
import { describePdfLink, isPdfUrl } from '../../src/url/pdf-link.js';

describe('isPdfUrl', () => {
    it('detects .pdf path and query/hash variants', () => {
        expect(isPdfUrl('https://example.com/report.pdf')).toBe(true);
        expect(isPdfUrl('https://cdn.example.com/docs/a.PDF')).toBe(true);
        expect(isPdfUrl('https://example.com/report.pdf?download=1')).toBe(true);
        expect(isPdfUrl('https://example.com/report.pdf#page=2')).toBe(true);
    });

    it('rejects non-pdf pages', () => {
        expect(isPdfUrl('https://example.com/article')).toBe(false);
        expect(isPdfUrl('https://example.com/pdf-guide.html')).toBe(false);
        expect(isPdfUrl('https://example.com/report.pdfx')).toBe(false);
    });

    it('rejects empty or invalid', () => {
        expect(isPdfUrl('')).toBe(false);
        expect(isPdfUrl('not-a-url')).toBe(false);
        expect(isPdfUrl('ftp://example.com/a.pdf')).toBe(false);
    });
});

describe('describePdfLink', () => {
    it('includes hostname', () => {
        expect(describePdfLink('https://www.sec.gov/files/a.pdf')).toContain('sec.gov');
        expect(describePdfLink('https://www.sec.gov/files/a.pdf')).toContain('PDF');
        expect(describePdfLink('https://www.sec.gov/files/a.pdf')).toContain('未抓取正文');
    });
});
