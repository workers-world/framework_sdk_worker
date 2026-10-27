import { describe, expect, it } from 'vitest';
import {
    describeQualityReject,
    isBinaryOrNonTextContent,
    isConsentOrBoilerplateText,
    isSiteNavigationShell,
    isThinArticleBody,
    isUsableFetchedText,
    QualityRejectDetail,
    stripAggregatorEmailNoise,
} from '../../src/evaluation/article-text-quality.js';

const BLOGTROTTR_SNIPPET = `Yahoo Finance
At Yahoo Finance, you get free stock quotes, up-to-date news, portfolio management resources, international market data, social interaction and mortgage rates that help you manage your financial life.

What to Expect From Align Technology's Next Quarterly Earnings Report
https://finance.yahoo.com/markets/stocks/articles/expect-align-technology-next-quarterly-065937919.html
Jul 9th 2026, 06:59

Media files:
https://media.zenfs.com/en/barchart_com_477/b63c711a1d81edaea11cbb32b25d904b

You are receiving this email because you subscribed to this feed at https://blogtrottr.com?lctg=8080662154
If you no longer wish to receive these emails, you can unsubscribe here:
https://blogtrottr.com/unsubscribe/6a4a53248805c5d4ce0ef5f1?lctg=8080662154`;

const YAHOO_COOKIE_WALL = `Ihre Datenschutzeinstellungen guce guce Ihre Privatsphäre ist uns wichtig Bei Yahoo verwenden wir Cookie-Richtlinie Cookies Mithilfe von Cookies können die Betreiber von Websites und Apps Informationen auf Ihrem Gerät speichern IAB Transparency & Consent Framework Alle akzeptieren Alle ablehnen Datenschutzeinstellungen verwalten technische Identifikationsmerkmale`;

describe('stripAggregatorEmailNoise', () => {
    it('removes blogtrottr footer and yahoo boilerplate', () => {
        const cleaned = stripAggregatorEmailNoise(BLOGTROTTR_SNIPPET);
        expect(cleaned).toContain('Align Technology');
        expect(cleaned).not.toContain('blogtrottr.com/unsubscribe');
        expect(cleaned).not.toContain('At Yahoo Finance, you get free stock quotes');
        expect(cleaned).not.toContain('Media files:');
    });
});

describe('isThinArticleBody', () => {
    it('detects blogtrottr shell as thin', () => {
        const cleaned = stripAggregatorEmailNoise(BLOGTROTTR_SNIPPET);
        expect(isThinArticleBody(cleaned)).toBe(true);
        expect(isThinArticleBody(BLOGTROTTR_SNIPPET)).toBe(true);
    });

    it('detects hacker news email shell as thin', () => {
        const hn = `Hacker News
Links for the intellectually curious, ranked by readers.

FreeCAD in the Browser
https://magik.net/freecad/
Jul 11th 2026, 00:44


Comments`;
        const cleaned = stripAggregatorEmailNoise(hn);
        expect(isThinArticleBody(cleaned)).toBe(true);
        expect(cleaned).toContain('FreeCAD');
        expect(cleaned).not.toContain('intellectually curious');
    });

    it('accepts substantive article text', () => {
        const longBody = 'Apple reported quarterly earnings. '.repeat(40);
        expect(isThinArticleBody(longBody)).toBe(false);
    });
});

describe('isConsentOrBoilerplateText', () => {
    it('detects Yahoo GDPR cookie wall', () => {
        expect(isConsentOrBoilerplateText(YAHOO_COOKIE_WALL)).toBe(true);
    });
});

describe('isUsableFetchedText', () => {
    it('rejects paywall / block pages', () => {
        expect(
            isUsableFetchedText('Please enable JavaScript to continue. Subscribe to read.'),
        ).toBe(false);
        expect(isUsableFetchedText('sad-panda China block page')).toBe(false);
    });

    it('rejects registration paywall preview', () => {
        const mckinseyPreview =
            'The state of AI in 2026. Eight in ten respondents say AI has improved productivity. Register for free to continue reading';
        expect(isUsableFetchedText(mckinseyPreview)).toBe(false);
        expect(describeQualityReject(mckinseyPreview)).toBe(QualityRejectDetail.paywall.code);
    });

    it('rejects German cookie consent wall', () => {
        expect(isUsableFetchedText(YAHOO_COOKIE_WALL)).toBe(false);
    });

    it('accepts long article-like text', () => {
        const article = 'Energy equities rose amid geopolitical tension. '.repeat(20);
        expect(isUsableFetchedText(article)).toBe(true);
    });

    it('rejects JPEG JFIF binary', () => {
        const jpegGarbage = `\uFFFD\uFFFD\uFFFD\uFFFD\u0000\u0010JFIF${'x'.repeat(500)}`;
        expect(isBinaryOrNonTextContent(jpegGarbage)).toBe(true);
        expect(isUsableFetchedText(jpegGarbage)).toBe(false);
    });

    it('rejects eastmoney navigation shell markdown', () => {
        const navShell = `* [财经](http://finance.eastmoney.com/)
* [焦点](http://finance.eastmoney.com/yaowen.html)
* [股票](http://stock.eastmoney.com/)
* [新股](http://stock.eastmoney.com/newstock.html)
* [期指](http://stock.eastmoney.com/gzqh.html)
* [期权](http://option.eastmoney.com/)
* [行情](http://quote.eastmoney.com/flash/sz300059.html)
* [数据](http://data.eastmoney.com/)
行情中心
[指数](http://quote.eastmoney.com/center/hszs.html)
[期指](http://quote.eastmoney.com/center/gridlist.html)
[期权](http://quote.eastmoney.com/center/qqsc.html)
[个股](http://quote.eastmoney.com/)
数据中心
[资金流向](https://acttg.eastmoney.com/pub/foo)
[主力排名](https://acttg.eastmoney.com/pub/bar)`;
        expect(isSiteNavigationShell(navShell)).toBe(true);
        expect(isUsableFetchedText(navShell.repeat(2))).toBe(false);
    });
});
