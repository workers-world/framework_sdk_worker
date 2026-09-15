/**
 * 将多节采集结果拼成一封摘要邮件。
 */
import { escapeHtml } from '../email/escape-html.js';
import type { CollectedDigestSection, ComposedDigestMail, DigestDefinition } from './types.js';

function buildDigestHtml(lines: string[]): string {
    const htmlParts = lines.map((l) => {
        if (l.startsWith('Dashboard: ') || l.startsWith('http://') || l.startsWith('https://')) {
            const url = l.replace(/^Dashboard:\s*/, '');
            if (l.startsWith('Dashboard: ')) {
                return `Dashboard: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
            }
            return `<a href="${escapeHtml(l)}">${escapeHtml(l)}</a>`;
        }
        if (l.startsWith('--- ') && l.endsWith(' ---')) {
            return `<strong>${escapeHtml(l)}</strong>`;
        }
        return escapeHtml(l);
    });
    return `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap">${htmlParts.join('\n')}</div>`;
}

export function composeDigestMail(
    definition: Pick<DigestDefinition, 'id' | 'subjectPrefix'>,
    collected: CollectedDigestSection[],
    periodLabel: string,
): ComposedDigestMail | null {
    const ordered = [...collected].sort((a, b) => a.order - b.order);
    const sectionSummaries: ComposedDigestMail['sectionSummaries'] = [];
    const bodyLines: string[] = [];
    let highlightCount = 0;
    let hasContent = false;

    for (const section of ordered) {
        const { result } = section;
        if (result.status === 'skip') {
            sectionSummaries.push({
                id: section.id,
                title: section.title,
                status: 'skip',
                reason: result.reason,
            });
            continue;
        }
        hasContent = true;
        if (result.status === 'error') {
            sectionSummaries.push({
                id: section.id,
                title: section.title,
                status: 'error',
                message: result.message,
            });
            bodyLines.push(`--- ${section.title} ---`);
            bodyLines.push(`本节采集失败：${result.message}`);
            bodyLines.push('');
            continue;
        }
        const hc = result.highlightCount ?? result.lines.length;
        highlightCount += hc;
        sectionSummaries.push({
            id: section.id,
            title: section.title,
            status: 'ok',
            highlightCount: hc,
        });
        bodyLines.push(`--- ${section.title} ---`);
        bodyLines.push(...result.lines);
        bodyLines.push('');
    }

    if (!hasContent) {
        return null;
    }

    const subject = `${definition.subjectPrefix} · ${highlightCount} 项待关注`.slice(0, 200);
    const header = [
        definition.subjectPrefix,
        periodLabel,
        `摘要项：${highlightCount}`,
        `definition: ${definition.id}`,
        '',
    ];
    const lines = [...header, ...bodyLines];
    const body = lines.join('\n').trimEnd();
    return {
        subject,
        body,
        html: buildDigestHtml(lines),
        highlightCount,
        sectionSummaries,
    };
}
