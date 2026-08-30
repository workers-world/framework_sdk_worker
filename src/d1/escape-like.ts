/**
 * LIKE 关键字转义：\ % _。
 *
 * 注意：SQLite 的 LIKE 默认没有转义字符——调用方 SQL 必须显式声明
 * `ESCAPE '\'` 才能让本函数的转义生效：
 *
 *   WHERE name LIKE ? ESCAPE '\'
 *
 * 用户输入拼接 LIKE 前必须经过本函数；等值比较请直接用参数绑定。
 */
export function escapeLike(kw: string): string {
    return kw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
