import { describe, expect, it } from 'vitest';
import {
    describeQualityReject,
    isBinaryOrNonTextContent,
    isConsentOrBoilerplateText,
    isSiteNavigationShell,
    isThinArticleBody,
    isUsableExtractedSnippet,
    isUsableFetchedText,
    QualityRejectDetail,
    textBodyMetrics,
} from '../../src/evaluation/article-text-quality.js';

describe('describeQualityReject remaining branches', () => {
    it('classifies empty binary cookie junk thin', () => {
        expect(describeQualityReject('   ')).toBe(QualityRejectDetail.empty.code);
        expect(describeQualityReject('%PDF-1.4 binary')).toBe(
            QualityRejectDetail.binary_content.code,
        );
        expect(describeQualityReject(`GIF89a${'x'.repeat(20)}`)).toBe(
            QualityRejectDetail.binary_content.code,
        );
        expect(isBinaryOrNonTextContent(`\x89PNG${'x'.repeat(20)}`)).toBe(true);
        expect(isBinaryOrNonTextContent('a\0b\0c\0d')).toBe(true);
        expect(isBinaryOrNonTextContent('   ')).toBe(false);
        expect(isBinaryOrNonTextContent('hello world')).toBe(false);
        expect(
            describeQualityReject('we use cookies. accept all. privacy settings. cookie policy'),
        ).toBe(QualityRejectDetail.cookie.code);
        expect(describeQualityReject(`sad-panda block page ${'word '.repeat(80)}`)).toBe(
            QualityRejectDetail.junk.code,
        );
        expect(describeQualityReject('short')).toBe(QualityRejectDetail.thin.code);
    });
});

describe('isUsableExtractedSnippet / thin / nav / consent extras', () => {
    it('rejects short binary nav junk consent and accepts long text', () => {
        expect(isUsableExtractedSnippet('tiny')).toBe(false);
        expect(isUsableExtractedSnippet(`%PDF-1.7 ${'a'.repeat(100)}`)).toBe(false);
        expect(
            isUsableExtractedSnippet(`Please enable JavaScript to continue. ${'x'.repeat(80)}`),
        ).toBe(false);
        expect(
            isUsableExtractedSnippet('Energy equities rose amid geopolitical tension. '.repeat(10)),
        ).toBe(true);
    });

    it('detects thin url-heavy bodies and consent keyword path', () => {
        expect(isThinArticleBody('see https://a.example/x and https://b.example/y now')).toBe(true);
        expect(isThinArticleBody(`https://only.example/one ${'word '.repeat(40)}`)).toBe(true);
        expect(isConsentOrBoilerplateText('cookie')).toBe(false);
        expect(
            isConsentOrBoilerplateText(
                'we use cookies and privacy settings on this cookie policy page',
            ),
        ).toBe(true);
        expect(isSiteNavigationShell('short nav')).toBe(false);
        const links = Array.from({ length: 12 }, (_, i) => `[t${i}](https://x.example/${i})`).join(
            '\n',
        );
        expect(isSiteNavigationShell(`${links}\n${'x '.repeat(20)}`)).toBe(true);
    });

    it('textBodyMetrics counts length and links', () => {
        expect(textBodyMetrics('  hello https://a.example https://b.example  ')).toEqual({
            bodyLen: 'hello https://a.example https://b.example'.length,
            linkCount: 2,
        });
    });

    it('covers paywall nav_shell fetched-text and fallback junk', () => {
        const paywall = `Subscribe to read the full article. ${'word '.repeat(50)}`;
        expect(describeQualityReject(paywall)).toBe(QualityRejectDetail.paywall.code);
        expect(isUsableFetchedText(paywall)).toBe(false);

        const navLinks = Array.from(
            { length: 12 },
            (_, i) => `[t${i}](https://x.example/${i})`,
        ).join('\n');
        expect(describeQualityReject(`${navLinks}\n${'x '.repeat(80)}`)).toBe(
            QualityRejectDetail.nav_shell.code,
        );

        const article = 'Energy markets moved as inventories tightened. '.repeat(20);
        expect(describeQualityReject(article)).toBe(QualityRejectDetail.junk.code);
        expect(isUsableFetchedText(article)).toBe(true);
        expect(isUsableFetchedText('short')).toBe(false);
        expect(isUsableFetchedText(`%PDF-1.4 ${'x'.repeat(200)}`)).toBe(false);
        expect(
            isUsableFetchedText(
                'we use cookies and privacy settings on this cookie policy page. '.repeat(8),
            ),
        ).toBe(false);
        expect(isUsableExtractedSnippet(`${navLinks}\n${'x '.repeat(40)}`)).toBe(false);
        expect(
            isUsableExtractedSnippet(
                'we use cookies and privacy settings on this cookie policy page. '.repeat(4),
            ),
        ).toBe(false);
    });
});
