import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface GitStatus {
  kind: "loading" | "ready" | "not-git" | "error";
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  error?: string;
}

interface GitFooterController {
  scheduleRefresh(): void;
  dispose(): void;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

let guardStarted = false;
let gitFooterController: GitFooterController | undefined;

const EMPTY_GIT_STATUS: GitStatus = {
  kind: "loading",
  branch: "loading",
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
};

function headerLines(theme: Theme): string[] {
  const accent = (text: string) => theme.fg("accent", text);
  const muted = (text: string) => theme.fg("muted", text);
  const dim = (text: string) => theme.fg("dim", text);

  return [
    "",
    accent("      ██╗  ██╗ █████╗  ██████╗ ██████╗ ██████╗ ███╗   ██╗"),
    accent("      ██║  ██║██╔══██╗██╔════╝██╔════╝██╔═══██╗████╗  ██║"),
    accent("      ███████║███████║██║     ██║     ██║   ██║██╔██╗ ██║"),
    accent("      ██╔══██║██╔══██║██║     ██║     ██║   ██║██║╚██╗██║"),
    accent("      ██║  ██║██║  ██║╚██████╗╚██████╗╚██████╔╝██║ ╚████║"),
    accent("      ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝"),
    "",
    `      ${theme.bold("浣熊特工队")} ${muted("Pi Coding Agent")} ${dim(`v${VERSION}`)}`,
    "",
  ];
}

function installHeader(ctx: ExtensionContext) {
  ctx.ui.setTitle("浣熊特工队");
  ctx.ui.setHeader((_tui, theme) => ({
    render(width: number): string[] {
      return headerLines(theme).map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  }));
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function formatContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (!usage || usage.percent === null || !contextWindow) {
    return "ctx ?";
  }
  return `ctx ${Math.round(usage.percent)}%/${Math.round(contextWindow / 1000)}k`;
}

function fitLine(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  if (!right) return truncateToWidth(left, width);

  const minimumGap = 2;
  let leftText = left;
  let rightText = right;

  while (visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(rightText) > 18) {
    rightText = truncateToWidth(rightText, visibleWidth(rightText) - 1, "");
  }
  while (visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(leftText) > 0) {
    leftText = truncateToWidth(leftText, visibleWidth(leftText) - 1, "");
  }

  const gap = Math.max(1, width - visibleWidth(leftText) - visibleWidth(rightText));
  return truncateToWidth(`${leftText}${" ".repeat(gap)}${rightText}`, width);
}

function formatCommandError(label: string, result: CommandResult): string {
  const detail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-6).join("\n");
  return `${label} 执行失败，退出码 ${result.code}${detail ? `\n${detail}` : ""}`;
}

function parseBranchHeader(line: string, status: GitStatus) {
  const body = line.slice(3).trim();
  const bracketIndex = body.indexOf(" [");
  const branchPart = bracketIndex >= 0 ? body.slice(0, bracketIndex) : body;
  const meta = bracketIndex >= 0 ? body.slice(bracketIndex + 2, -1) : "";
  const [branch, upstream] = branchPart.split("...");

  status.branch = branch || "unknown";
  status.upstream = upstream;

  const ahead = meta.match(/ahead (\d+)/);
  const behind = meta.match(/behind (\d+)/);
  status.ahead = ahead ? Number(ahead[1]) : 0;
  status.behind = behind ? Number(behind[1]) : 0;
}

function parseGitStatusOutput(stdout: string): GitStatus {
  const status: GitStatus = {
    ...EMPTY_GIT_STATUS,
    kind: "ready",
    branch: "unknown",
  };

  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("## ")) {
      parseBranchHeader(line, status);
      continue;
    }

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const pair = `${indexStatus}${worktreeStatus}`;

    if (pair === "??") {
      status.untracked++;
      continue;
    }

    if (indexStatus === "U" || worktreeStatus === "U" || pair === "AA" || pair === "DD") {
      status.conflicts++;
      continue;
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      status.staged++;
    }
    if (worktreeStatus !== " " && worktreeStatus !== "?") {
      status.unstaged++;
    }
  }

  return status;
}

function isGitStatusClean(status: GitStatus): boolean {
  return status.staged + status.unstaged + status.untracked + status.conflicts === 0;
}

async function isGitWorkTree(pi: ExtensionAPI, cwd: string): Promise<boolean> {
  const result = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    timeout: 1_500,
  });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function initializeGitRepository(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  const confirmed = await ctx.ui.confirm(
    "初始化 Git 仓库？",
    `当前目录不是 Git 项目：${formatCwd(ctx.cwd)}\n是否执行 git init 后进入聊天？`,
  );
  if (!confirmed) {
    ctx.ui.setWidget("raccoon-git-required", [
      ctx.ui.theme.fg("warning", "当前目录不是 Git 项目"),
      "已取消初始化，浣熊特工队将退出。",
    ]);
    ctx.ui.notify("已取消 Git 初始化。", "warning");
    setTimeout(() => ctx.shutdown(), 250);
    return false;
  }

  const result = await pi.exec("git", ["init"], {
    cwd: ctx.cwd,
    timeout: 10_000,
  });
  if (result.code === 0) {
    ctx.ui.setWidget("raccoon-git-required", undefined);
    ctx.ui.notify("Git 仓库初始化完成。", "info");
    return true;
  }

  ctx.ui.setWidget("raccoon-git-required", [
    ctx.ui.theme.fg("error", "Git 初始化失败"),
    ...formatCommandError("git init", result).split(/\r?\n/).slice(0, 8),
  ]);
  ctx.ui.notify("Git 初始化失败，已退出。", "error");
  setTimeout(() => ctx.shutdown(), 250);
  return false;
}

async function readGitStatus(pi: ExtensionAPI, cwd: string): Promise<GitStatus> {
  const result = await pi.exec("git", ["status", "--porcelain=v1", "--branch"], {
    cwd,
    timeout: 1_500,
  });

  if (result.code === 0) {
    return parseGitStatusOutput(result.stdout);
  }

  const detail = (result.stderr || result.stdout).trim();
  if (/not a git repository/i.test(detail)) {
    return { ...EMPTY_GIT_STATUS, kind: "not-git", branch: "no git" };
  }

  return {
    ...EMPTY_GIT_STATUS,
    kind: "error",
    branch: "git error",
    error: detail.split(/\r?\n/).slice(-1)[0] || `git exited ${result.code}`,
  };
}

function renderGitSummary(theme: Theme, status: GitStatus): string {
  if (status.kind === "loading") {
    return `${theme.fg("accent", "Git")} ${theme.fg("muted", "loading...")}`;
  }
  if (status.kind === "not-git") {
    return `${theme.fg("warning", "Git")} ${theme.fg("muted", "No git repository")}`;
  }
  if (status.kind === "error") {
    return `${theme.fg("error", "Git error")} ${theme.fg("muted", status.error || "unknown error")}`;
  }

  const dirty = !isGitStatusClean(status);
  const branch = theme.bold(status.branch);
  const state = dirty ? theme.fg("warning", "dirty") : theme.fg("success", "clean");
  const syncParts: string[] = [];
  if (status.upstream) syncParts.push(theme.fg("muted", `upstream ${status.upstream}`));
  if (status.ahead > 0) syncParts.push(theme.fg("accent", `ahead ${status.ahead}`));
  if (status.behind > 0) syncParts.push(theme.fg("warning", `behind ${status.behind}`));

  return [`${theme.fg("accent", "Git")} ${branch}`, state, ...syncParts].join("  ");
}

function renderGitCounters(theme: Theme, status: GitStatus): string {
  if (status.kind !== "ready") {
    return theme.fg("muted", "staged 0  unstaged 0  untracked 0  conflicts 0");
  }

  const color = status.conflicts > 0 ? "error" : isGitStatusClean(status) ? "success" : "warning";
  return [
    theme.fg(color, `staged ${status.staged}`),
    theme.fg(color, `unstaged ${status.unstaged}`),
    theme.fg(color, `untracked ${status.untracked}`),
    theme.fg(status.conflicts > 0 ? "error" : "muted", `conflicts ${status.conflicts}`),
  ].join("  ");
}

function installGitFooter(pi: ExtensionAPI, ctx: ExtensionContext): GitFooterController {
  gitFooterController?.dispose();

  let status: GitStatus = { ...EMPTY_GIT_STATUS };
  let activeTui: TUI | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let pending = false;
  let disposed = false;

  const requestRender = () => activeTui?.requestRender();

  const refreshNow = async () => {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }

    inFlight = true;
    try {
      status = await readGitStatus(pi, ctx.cwd);
    } catch (error) {
      status = {
        ...EMPTY_GIT_STATUS,
        kind: "error",
        branch: "git error",
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      inFlight = false;
      requestRender();
      if (pending) {
        pending = false;
        scheduleRefresh();
      }
    }
  };

  const scheduleRefresh = () => {
    if (disposed) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refreshNow();
    }, 250);
  };

  class GitFooterPanel implements Component {
    private unsubscribeBranch: (() => void) | undefined;

    constructor(tui: TUI, unsubscribeBranch: () => void) {
      activeTui = tui;
      this.unsubscribeBranch = unsubscribeBranch;
    }

    render(width: number): string[] {
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
      const thinking = pi.getThinkingLevel();
      const project = basename(ctx.cwd) || formatCwd(ctx.cwd);
      const topLeft = renderGitSummary(ctx.ui.theme, status);
      const topRight = ctx.ui.theme.fg("dim", formatCwd(ctx.cwd));
      const bottomLeft = renderGitCounters(ctx.ui.theme, status);
      const bottomRight = ctx.ui.theme.fg("dim", `${project}  ${model}  ${thinking}  ${formatContextUsage(ctx)}`);

      return [fitLine(topLeft, topRight, width), fitLine(bottomLeft, bottomRight, width)];
    }

    invalidate(): void {}

    dispose(): void {
      this.unsubscribeBranch?.();
      this.unsubscribeBranch = undefined;
      if (activeTui) activeTui = undefined;
    }
  }

  ctx.ui.setFooter((tui, _theme, footerData) => {
    const unsubscribeBranch = footerData.onBranchChange(scheduleRefresh);
    return new GitFooterPanel(tui, unsubscribeBranch);
  });
  ctx.ui.setStatus("raccoon-agents", ctx.ui.theme.fg("accent", "浣熊特工队"));
  void refreshNow();

  const controller: GitFooterController = {
    scheduleRefresh,
    dispose() {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = undefined;
      activeTui = undefined;
      ctx.ui.setFooter(undefined);
      ctx.ui.setStatus("raccoon-agents", undefined);
    },
  };
  gitFooterController = controller;
  return controller;
}

async function ensureGitRepository(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
  if (await isGitWorkTree(pi, ctx.cwd)) return true;
  return initializeGitRepository(pi, ctx);
}

export default function raccoonAgents(pi: ExtensionAPI) {
  pi.on("tool_execution_end", () => {
    gitFooterController?.scheduleRefresh();
  });

  pi.on("turn_end", () => {
    gitFooterController?.scheduleRefresh();
  });

  pi.on("session_shutdown", () => {
    gitFooterController?.dispose();
    gitFooterController = undefined;
    guardStarted = false;
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) {
      console.error("浣熊特工队需要交互式 TUI 模式。");
      ctx.shutdown();
      return;
    }

    installHeader(ctx);

    if (guardStarted) return;
    guardStarted = true;

    try {
      if (!(await ensureGitRepository(pi, ctx))) return;
      installGitFooter(pi, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setWidget("raccoon-git-required", [
        ctx.ui.theme.fg("error", "Git 检查失败"),
        ...message.split(/\r?\n/).slice(0, 8),
      ]);
      ctx.ui.notify("Git 检查失败，已退出。", "error");
      setTimeout(() => ctx.shutdown(), 250);
      guardStarted = false;
    }
  });
}
