import { describe, expect, it } from 'vitest';
import {
    ArticleFetchReason,
    describeArticleFetchReason,
} from '../../src/evaluation/article-fetch-reason.js';
import {
    describeQualityRejectDetail,
    isQualitySoftKeepDetail,
    QualityRejectDetail,
} from '../../src/evaluation/quality-reject-detail.js';
import {
    describeSummaryDecisionBecause,
    SummaryDecisionBecause,
} from '../../src/evaluation/summary-decision-because.js';

describe('summary / fetch / quality code tables', () => {
    it('describes SummaryDecisionBecause in Chinese', () => {
        expect(describeSummaryDecisionBecause(SummaryDecisionBecause.thin_snippet.code)).toContain(
            '邮件片段过薄',
        );
        expect(
            describeSummaryDecisionBecause(SummaryDecisionBecause.article_url_bypass.code),
        ).toContain('强制 LLM');
        expect(describeSummaryDecisionBecause(SummaryDecisionBecause.paywall.code)).toContain(
            '注册墙',
        );
        expect(describeSummaryDecisionBecause('unknown_code')).toBe('unknown_code');
    });

    it('describes ArticleFetchReason in Chinese', () => {
        expect(describeArticleFetchReason(ArticleFetchReason.product_landing_meta.code)).toContain(
            'meta',
        );
        expect(describeArticleFetchReason(ArticleFetchReason.quality_soft_reject.code)).toContain(
            '软保留',
        );
    });

    it('describes QualityRejectDetail and soft-keep whitelist', () => {
        expect(describeQualityRejectDetail(QualityRejectDetail.nav_shell.code)).toContain('导航壳');
        expect(describeQualityRejectDetail(QualityRejectDetail.paywall.code)).toContain('注册墙');
        expect(isQualitySoftKeepDetail(QualityRejectDetail.thin.code)).toBe(true);
        expect(isQualitySoftKeepDetail(QualityRejectDetail.paywall.code)).toBe(true);
        expect(isQualitySoftKeepDetail(QualityRejectDetail.nav_shell.code)).toBe(false);
        expect(isQualitySoftKeepDetail(QualityRejectDetail.cookie.code)).toBe(false);
        expect(isQualitySoftKeepDetail(QualityRejectDetail.junk.code)).toBe(false);
    });
});
