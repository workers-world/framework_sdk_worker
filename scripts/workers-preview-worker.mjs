#!/usr/bin/env node
import { runWorkersDeployCli } from "./deploy-worker-cli.mjs";

runWorkersDeployCli("preview", process.cwd(), process.argv.slice(2), process.env);
