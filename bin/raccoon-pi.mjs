#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const passthroughArgs = process.argv.slice(2);

const child = spawn("pi", ["-e", packageRoot, ...passthroughArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`无法启动 pi：${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`pi 被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
