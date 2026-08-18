/** LIKE 关键字转义：\ % _ */
export function escapeLike(kw: string): string {
    return kw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
