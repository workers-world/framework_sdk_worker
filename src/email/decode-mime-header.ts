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
            bytes.push(parseInt(qp.slice(i + 1, i + 3), 16));
            i += 2;
          } else {
            bytes.push(qp.charCodeAt(i));
          }
        }
        return new TextDecoder(normalizedCharset).decode(new Uint8Array(bytes));
      } catch {
        return match;
      }
    },
  );

  return decoded.replace(/\s+/g, ' ').trim();
}
