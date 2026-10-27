import { describe, expect, it } from 'vitest';
import type {
    AttachmentContent,
    AttachmentReference,
    DigestAttachmentReference,
} from '../../src/attachment/types.js';
import type { DigestItemLlm, NotifyAttachment } from '../../src/notify/client.js';

describe('attachment hierarchy', () => {
    it('NotifyAttachment is Assignment-compatible with AttachmentContent', () => {
        const content: AttachmentContent = {
            filename: 'a.pdf',
            contentBase64: 'YWJj',
            contentType: 'application/pdf',
        };
        const notify: NotifyAttachment = content;
        expect(notify.filename).toBe('a.pdf');
        expect(notify.contentBase64).toBe('YWJj');
    });

    it('DigestAttachmentReference extends AttachmentReference with kind', () => {
        const ref: DigestAttachmentReference = {
            filename: 'hn-1.pdf',
            contentType: 'application/pdf',
            r2Key: 'digest-attach/hn_comment_pdf/2026-10-01/k/hn-1.pdf',
            kind: 'hn_comment_pdf',
            sizeBytes: 12,
        };
        const staged: AttachmentReference = ref;
        expect(staged.r2Key).toContain('digest-attach/');
        expect(ref.kind).toBe('hn_comment_pdf');
    });

    it('DigestItemLlm may carry attachmentReferences without bytes', () => {
        const item: DigestItemLlm = {
            itemFormat: 'llm',
            ruleId: 'hn',
            subjectPrefix: '[HN]',
            to: 'rss@example.com',
            title: 't',
            summary: 's',
            url: 'https://example.com',
            attachmentReferences: [
                {
                    filename: 'hn-1.pdf',
                    contentType: 'application/pdf',
                    r2Key: 'digest-attach/hn_comment_pdf/x/hn-1.pdf',
                    kind: 'hn_comment_pdf',
                },
            ],
        };
        expect(item.attachmentReferences?.[0]?.r2Key).toBeTruthy();
        expect('contentBase64' in (item.attachmentReferences?.[0] as object)).toBe(false);
    });
});
