#!/usr/bin/env node
/**
 * package.json 根 dependencies/devDependencies 与 package-lock packages[""] 是否一致。
 * exit 0 = 已同步；1 = 未同步。
 */
import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function rootDepsInSync(pkg, lock) {
  const root = lock.packages?.[""] ?? {};
  function same(a, b) {
    const aa = a ?? {};
    const bb = b ?? {};
    const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
    for (const k of keys) {
      if (String(aa[k] ?? "") !== String(bb[k] ?? "")) return false;
    }
    return true;
  }
  return (
    same(pkg.dependencies, root.dependencies) &&
    same(pkg.devDependencies, root.devDependencies)
  );
}

function main() {
  if (!fs.existsSync("package.json")) {
    console.error("package.json 不存在");
    process.exit(1);
  }
  if (!fs.existsSync("package-lock.json")) {
    process.exit(1);
  }
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  if (rootDepsInSync(pkg, lock)) {
    process.exit(0);
  }
  process.exit(1);
}

main();
