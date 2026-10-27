import { describe, expect, it } from 'vitest';
import {
    type DigestAttachmentReference,
    hasDigestAttachBytes,
    hasDigestHrefOnly,
} from '../../src/attachment/types.js';

describe('digest attachment ref helpers', () => {
    it('treats r2Key as hydratable MIME', () => {
        const ref: DigestAttachmentReference = {
            kind: 'email_html_image',
            filename: 'a.png',
            r2Key: 'digest-attach/email_html_image/x/a.png',
        };
        expect(hasDigestAttachBytes(ref)).toBe(true);
        expect(hasDigestHrefOnly(ref)).toBe(false);
    });

    it('treats href-only video as body print, not MIME', () => {
        const ref: DigestAttachmentReference = {
            kind: 'video',
            filename: 'rclone.copy',
            href: 'rclone copy r2:email-rule-digests/digest-media/video/d/k/ ./digest-media/video/d/k/',
        };
        expect(hasDigestAttachBytes(ref)).toBe(false);
        expect(hasDigestHrefOnly(ref)).toBe(true);
    });
});
