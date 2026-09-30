#!/usr/bin/env node
/**
 * Workers 远端 deploy/preview 门户：自动 wrangler ↔ cf（见 cloudflare.config.ts）。
 * BUILD_* 透传仅 wrangler deploy 路径（cf deploy 无 --var，/v1/meta 在 cf 仓需 config 侧处理）。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** @typedef {'auto' | 'wrangler' | 'cf'} DeployRuntime */

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Exclude<DeployRuntime, 'auto'>}
 */
export function resolveDeployRuntime(cwd, env = process.env) {
	const override = (env.WORKERS_DEPLOY_RUNTIME ?? "").trim().toLowerCase();
	if (override === "wrangler" || override === "cf") {
		return override;
	}
	if (existsSync(path.join(cwd, "cloudflare.config.ts"))) {
		return "cf";
	}
	return "wrangler";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function buildBuildMetaWranglerArgs(env = process.env) {
	const sha = (env.WORKERS_CI_COMMIT_SHA ?? "").trim();
	const branch = (env.WORKERS_CI_BRANCH ?? "master").trim() || "master";
	const time =
		(env.BUILD_TIME ?? "").trim() ||
		new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	return [
		`--var`,
		`BUILD_COMMIT_SHA:${sha}`,
		`--var`,
		`BUILD_BRANCH:${branch}`,
		`--var`,
		`BUILD_TIME:${time}`,
	];
}

/**
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseDeployCliArgs(argv) {
	let buildMeta = false;
	const passthrough = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--build-meta") {
			buildMeta = true;
			continue;
		}
		if (arg === "--") {
			passthrough.push(...argv.slice(i + 1));
			break;
		}
		passthrough.push(arg);
	}
	return { buildMeta, passthrough };
}

/**
 * @param {'deploy' | 'preview'} mode
 * @param {string} cwd
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
export function runWorkersDeployCli(mode, cwd, argv, env = process.env) {
	const { buildMeta, passthrough } = parseDeployCliArgs(argv);
	const runtime = resolveDeployRuntime(cwd, env);

	let cmd;
	let args;
	if (mode === "deploy") {
		if (runtime === "cf") {
			cmd = "cf";
			args = ["deploy", ...passthrough];
		} else {
			cmd = "wrangler";
			args = ["deploy", ...(buildMeta ? buildBuildMetaWranglerArgs(env) : []), ...passthrough];
		}
	} else if (runtime === "cf") {
		cmd = "cf";
		args = ["previews", "deploy", ...passthrough];
	} else {
		cmd = "wrangler";
		args = ["preview", ...passthrough];
	}

	const result = spawnSync("npx", ["--yes", cmd, ...args], {
		cwd,
		env,
		stdio: "inherit",
		shell: false,
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	process.exit(result.status ?? 1);
}
