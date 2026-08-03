export interface EmailProbe {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    messageId: string;
}

import { decodeMimeHeader } from './decode-mime-header.js';

export function buildEmailProbe(message: ForwardableEmailMessage): EmailProbe {
    const rawSubject = message.headers.get('subject')?.trim() || '';
    const subject = decodeMimeHeader(rawSubject) || rawSubject || '(no subject)';

    return {
        from: message.from,
        to: message.to,
        subject,
        text: '',
        html: '',
        messageId: message.headers.get('message-id')?.trim() || `${message.from}-${subject}`,
    };
}

export function subjectFromMessage(message: ForwardableEmailMessage): string {
    const rawSubject = message.headers.get('subject')?.trim() || '';
    return decodeMimeHeader(rawSubject) || rawSubject || '(no subject)';
}
