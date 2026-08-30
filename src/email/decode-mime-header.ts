/** 解码 RFC 2047 编码的邮件头（如 =?utf-8?Q?...?=） */
export function decodeMimeHeader(value: string): string {
    if (!value.trim()) {
        return '';
    }

    const decoded = value.replace(
        /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
        (match, charset: string, encoding: string, text: string) => {
            try {
                const normalizedCharset = charset.trim().toLowerCase();
                if (encoding.toUpperCase() === 'B') {
                    const binary = atob(text.replace(/\s/g, ''));
                    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
                    return new TextDecoder(normalizedCharset).decode(bytes);
                }
                const qp = text.replace(/_/g, ' ');
                const bytes: number[] = [];
                for (let i = 0; i < qp.length; i++) {
                    if (qp[i] === '=' && i + 2 < qp.length) {
                        const hex = qp.slice(i + 1, i + 3);
                        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                            bytes.push(Number.parseInt(hex, 16));
                            i += 2;
                            continue;
                        }
                        // 跟随字符非 hex（如 "=x1"）：按字面 '=' 保留，不做静默归零
                        bytes.push(qp.charCodeAt(i));
                        continue;
                    }
                    bytes.push(qp.charCodeAt(i));
                }
                return new TextDecoder(normalizedCharset).decode(new Uint8Array(bytes));
            } catch {
                return match;
            }
        },
    );

    return decoded.replace(/\s+/g, ' ').trim();
}
