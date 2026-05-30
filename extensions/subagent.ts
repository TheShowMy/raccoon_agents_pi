/**
 * 简化版 Subagent 引擎 — 专用于代码审核并行执行
 *
 * 基于 Pi 社区 subagent 扩展简化，只保留 parallel 模式。
 * 每个 subagent 运行在独立的 pi 子进程中，完全隔离上下文。
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// ── 类型定义 ──────────────────────────────────────────────

export interface AgentConfig {
    name: string;
    description: string;
    model?: string;
    systemPrompt: string;
}

export interface SingleResult {
    agent: string;
    task: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    model?: string;
    timedOut: boolean;
}

export interface ParallelReviewResult {
    results: SingleResult[];
    successCount: number;
    failCount: number;
}

export interface ParallelReviewOptions {
    /** 单个子进程超时（毫秒），默认 60000 */
    timeout?: number;
    /** 最大并发数，默认 3 */
    concurrency?: number;
    /** 流式进度回调 */
    onUpdate?: (agentName: string, chunk: string) => void;
    /** 外部取消信号 */
    signal?: AbortSignal;
    /** 单个 agent 开始执行时回调 */
    onTaskStart?: (agentName: string) => void;
    /** 单个 agent 执行结束时回调 */
    onTaskEnd?: (agentName: string, success: boolean) => void;
}

// ── Agent 发现（供外部使用，保留） ──────────────────────────────────────────────

export function loadAgentFromFile(filePath: string): AgentConfig | null {
    if (!existsSync(filePath)) return null;
    try {
        const content = readFileSync(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);
        if (!frontmatter.name || !frontmatter.description) return null;
        return {
            name: frontmatter.name,
            description: frontmatter.description,
            model: frontmatter.model,
            systemPrompt: body,
        };
    } catch {
        return null;
    }
}

/**
 * 解析 YAML frontmatter，支持多行缩进值
 * 注：不支持 YAML 数组语法（- item）和嵌套对象
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };

    const frontmatter: Record<string, string> = {};
    const lines = match[1].split("\n");
    let currentKey: string | null = null;
    let currentValue: string[] = [];

    const flush = () => {
        if (currentKey !== null) {
            frontmatter[currentKey] = currentValue.join("\n").trim();
            currentKey = null;
            currentValue = [];
        }
    };

    for (const line of lines) {
        const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (keyMatch) {
            flush();
            currentKey = keyMatch[1];
            const val = keyMatch[2].trim();
            if (val) currentValue.push(val);
        } else if (currentKey !== null && line.startsWith(" ")) {
            // 多行值缩进
            currentValue.push(line.trimStart());
        } else if (currentKey !== null) {
            currentValue.push(line);
        }
    }
    flush();

    return { frontmatter, body: match[2] };
}

// ── 并发控制 ──────────────────────────────────────────────

async function mapWithConcurrencyLimit<TIn, TOut>(
    items: TIn[],
    concurrency: number,
    fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results: TOut[] = new Array(items.length);
    let nextIndex = 0;

    const workers = new Array(limit).fill(null).map(async () => {
        while (true) {
            const current = nextIndex++;
            if (current >= items.length) return;
            results[current] = await fn(items[current], current);
        }
    });

    await Promise.all(workers);
    return results;
}

// ── 单个 Agent 执行 ──────────────────────────────────────────────

async function runSingleAgent(
    cwd: string,
    agent: AgentConfig,
    task: string,
    options?: ParallelReviewOptions,
): Promise<SingleResult> {
    const result: SingleResult = {
        agent: agent.name,
        task,
        exitCode: 0,
        stdout: "",
        stderr: "",
        model: agent.model,
        timedOut: false,
    };

    const timeoutMs = options?.timeout ?? 60_000;
    const args: string[] = ["--mode", "json", "-p", "--no-session"];
    if (agent.model) args.push("--model", agent.model);

    let tmpPromptPath: string | null = null;
    let tmpDir: string | null = null;

    try {
        // 将 system prompt 写入临时文件
        if (agent.systemPrompt.trim()) {
            tmpDir = createSecureTmpDir();
            tmpPromptPath = join(tmpDir, `agent-${sanitizeFilename(agent.name)}.md`);
            writeFileSync(tmpPromptPath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
            args.push("--append-system-prompt", tmpPromptPath);
        }

        args.push(`Task: ${task}`);

        const invocation = getPiInvocation(args);
        const { exitCode, stdout, stderr, timedOut } = await spawnWithTimeout(
            invocation.command,
            invocation.args,
            { cwd, timeout: timeoutMs, signal: options?.signal },
            (chunk) => {
                // 流式解析 JSON 行，提取 assistant 消息文本
                try {
                    const event = JSON.parse(chunk);
                    if (event.type === "message_end" && event.message?.role === "assistant") {
                        for (const part of event.message.content) {
                            if (part.type === "text") {
                                result.stdout += part.text;
                                // 流式回调
                                if (options?.onUpdate) {
                                    options.onUpdate(agent.name, part.text);
                                }
                            }
                        }
                    }
                } catch {
                    // 非 JSON 行，可能是一般输出，记录到 stderr
                    if (chunk.trim() && !chunk.trim().startsWith("{")) {
                        result.stderr += chunk + "\n";
                    }
                }
            },
        );

        result.exitCode = exitCode;
        result.timedOut = timedOut;
        result.stderr += stderr;
    } finally {
        if (tmpPromptPath) {
            try { unlinkSync(tmpPromptPath); } catch { /* ignore */ }
        }
        if (tmpDir) {
            try { rmdirSync(tmpDir); } catch { /* ignore */ }
        }
    }

    return result;
}

/**
 * 带超时的子进程执行，支持流式输出
 */
function spawnWithTimeout(
    command: string,
    args: string[],
    options: { cwd: string; timeout: number; signal?: AbortSignal },
    onLine: (line: string) => void,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let buffer = "";
        let timedOut = false;

        const proc = spawn(command, args, {
            cwd: options.cwd,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });

        const killProc = (isTimeout = false) => {
            if (isTimeout) timedOut = true;
            proc.kill("SIGTERM");
            setTimeout(() => {
                if (!proc.killed) proc.kill("SIGKILL");
            }, 5000);
        };

        const timeoutTimer = setTimeout(() => killProc(true), options.timeout);

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (line.trim()) onLine(line);
            }
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            clearTimeout(timeoutTimer);
            if (buffer.trim()) onLine(buffer);
            resolve({ exitCode: code ?? 0, stdout, stderr, timedOut });
        });

        proc.on("error", (err) => {
            clearTimeout(timeoutTimer);
            stderr += err.message;
            resolve({ exitCode: 1, stdout, stderr, timedOut });
        });

        if (options.signal) {
            const onAbort = () => {
                clearTimeout(timeoutTimer);
                killProc(false);
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

function createSecureTmpDir(): string {
    const dir = join(tmpdir(), `pi-review-${Date.now()}-${randomBytes(4).toString("hex")}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
    const currentScript = process.argv[1];
    const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
    if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
        return { command: process.execPath, args: [currentScript, ...args] };
    }

    const execName = (path: string) => path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName(process.execPath) ?? "");
    if (!isGenericRuntime) {
        return { command: process.execPath, args };
    }

    return { command: "pi", args };
}

// ── 并行审核接口 ──────────────────────────────────────────────

export async function runParallelReview(
    cwd: string,
    agents: AgentConfig[],
    diffContent: string,
    options?: ParallelReviewOptions,
): Promise<ParallelReviewResult> {
    // 将 diff 写入临时文件，供所有 agent 读取
    const tmpDir = createSecureTmpDir();
    const diffPath = join(tmpDir, "pr-diff.patch");
    writeFileSync(diffPath, diffContent, { encoding: "utf-8", mode: 0o600 });

    const diffRef = diffPath.replace(homedir(), "~");

    const tasks = agents.map((agent) => ({
        agent,
        task: `请审核以下 PR diff 文件：${diffRef}\n\n请读取该文件，按照你的专业角度进行深度审核，给出结构化结论。`,
    }));

    try {
        const concurrency = options?.concurrency ?? 3;
        const results = await mapWithConcurrencyLimit(
            tasks,
            concurrency,
            async (t) => {
                options?.onTaskStart?.(t.agent.name);
                const result = await runSingleAgent(cwd, t.agent, t.task, options);
                options?.onTaskEnd?.(t.agent.name, result.exitCode === 0 && !result.timedOut);
                return result;
            },
        );

        const successCount = results.filter((r) => r.exitCode === 0 && !r.timedOut).length;
        const failCount = results.filter((r) => r.exitCode !== 0 || r.timedOut).length;

        return { results, successCount, failCount };
    } finally {
        // 清理临时文件
        try { unlinkSync(diffPath); } catch { /* ignore */ }
        try { rmdirSync(tmpDir); } catch { /* ignore */ }
    }
}

// ── 预定义审核 Agent ──────────────────────────────────────────────

import { loadTierConfig, routeModel } from "./model-tier.js";

export interface ReviewAgents {
    logicAgent: AgentConfig;
    maintainAgent: AgentConfig;
    scanAgent: AgentConfig;
}

export function createReviewAgents(): ReviewAgents {
    const tierConfig = loadTierConfig();

    // 从各档位获取一个模型
    const { models: highModels } = routeModel(tierConfig, "high");
    const { models: mediumModels } = routeModel(tierConfig, "medium");
    const { models: lowModels } = routeModel(tierConfig, "low");

    const highModel = highModels[0];
    const mediumModel = mediumModels[0];
    const lowModel = lowModels[0];

    return {
        logicAgent: {
            name: "逻辑与安全审核员",
            description: "深度分析业务逻辑正确性、安全漏洞和性能问题（高档模型）",
            model: highModel,
            systemPrompt: `你是一位资深的代码审核专家，专注于以下三个高档审核角度：

## 🧠 逻辑正确性
- 检查所有分支条件（if/else/switch）是否都处理了
- 检查循环是否有正确的终止条件，是否会死循环
- 检查异步操作是否有正确的错误处理（try/catch、.catch）
- 检查数值计算是否考虑了精度、溢出、除零等问题
- 检查状态更新是否原子化，是否存在竞态条件

## 🔒 安全性
- 检查用户输入是否做了校验和转义
- 检查是否有 SQL/NoSQL/命令注入风险
- 检查是否有 XSS（跨站脚本）漏洞
- 检查敏感数据（密钥、token、密码）是否硬编码或泄露
- 检查权限检查是否在服务端完成，能否被客户端绕过

## ⚡ 性能
- 检查循环内是否有可移出的重复计算
- 检查是否有嵌套循环导致 O(n²) 复杂度
- 检查大数据量时是否有分页/流式处理
- 检查是否有内存泄漏（未清理的定时器、事件监听、闭包引用）
- 检查数据库查询是否可优化（索引、联表、N+1）

## 输出格式
对每个检查点给出明确结论：
- ✅ 通过 — 代码符合要求
- ⚠️ 需关注 — 有潜在问题，说明原因和代码位置
- ❌ 不通过 — 必须修复的问题

最后给出总体评价：通过 / 有条件通过 / 不通过。`,
        },
        maintainAgent: {
            name: "可维护性审核员",
            description: "分析代码可维护性、测试覆盖和兼容性（中档模型）",
            model: mediumModel,
            systemPrompt: `你是一位代码质量审核专家，专注于以下三个中档审核角度：

## 📐 可维护性
- 检查函数/变量/类命名是否清晰表达意图
- 检查函数是否过长（超过 50 行建议拆分）
- 检查是否有重复代码可提取为公共函数
- 检查是否遵循单一职责原则
- 检查注释是否必要且准确（避免注释和代码矛盾）
- 检查类型定义是否完整（TypeScript 类型、接口文档）

## 🧪 测试覆盖
- 检查新增代码是否有对应的单元测试
- 检查边界条件是否被测试覆盖
- 检查错误路径/异常处理是否被测试
- 检查测试是否独立，不依赖外部状态或顺序
- 检查 Mock 是否合理，是否过度 mock 导致测试无意义
- 检查测试命名是否清晰描述了测试场景

## 🔌 兼容性
- 检查公共 API 是否有破坏性变更（Breaking Change）
- 检查类型定义是否向后兼容
- 检查依赖升级是否会导致版本冲突
- 检查是否有废弃（deprecated）API 的替代方案
- 检查配置文件变更是否影响现有环境
- 检查数据库迁移脚本是否正确且可回滚

## 输出格式
对每个检查点给出明确结论：
- ✅ 通过 — 代码符合要求
- ⚠️ 需关注 — 有潜在问题，说明原因和代码位置
- ❌ 不通过 — 必须修复的问题

最后给出总体评价：通过 / 有条件通过 / 不通过。`,
        },
        scanAgent: {
            name: "快速扫描员",
            description: "快速扫描命名规范、代码风格和简单错误（低档模型）",
            model: lowModel,
            systemPrompt: `你是一位快速代码扫描员，任务是用最低成本快速发现代码中的明显问题。

## 扫描重点（快速、轻量）
- 拼写错误（变量名、注释、字符串）
- 明显的语法错误
- 未使用的导入/变量
- 不一致的代码风格（缩进、引号、分号）
- 明显的逻辑错误（如 always true/false 条件）
- console.log 等调试代码残留
- TODO/FIXME 注释是否需要处理

## 输出格式
列出发现的问题（最多 10 条），每条包含：
1. 问题描述
2. 代码位置（文件和行号）
3. 建议修复方式

如果没有发现问题，直接回复"✅ 快速扫描未发现问题"。`,
        },
    };
}

// ── 格式化审核报告 ──────────────────────────────────────────────

export function formatParallelReviewReport(result: ParallelReviewResult): string {
    const lines: string[] = [];
    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push(`🔍 多模型并行审核结果 (${result.successCount}/${result.results.length} 成功)`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("");

    for (const r of result.results) {
        const icon = r.timedOut ? "⏱️" : r.exitCode === 0 ? "✅" : "❌";
        lines.push(`${icon} **${r.agent}** ${r.model ? `(${r.model})` : ""}`);

        if (r.timedOut) {
            lines.push(`  执行超时（可能模型响应过慢或任务过大）`);
        } else if (r.exitCode !== 0) {
            lines.push(`  执行失败（退出码 ${r.exitCode}）`);
            if (r.stderr) {
                lines.push(`  stderr: ${r.stderr.slice(0, 200)}`);
            }
        } else {
            lines.push("");
            lines.push(r.stdout || "（无输出）");
        }

        lines.push("");
        lines.push("---");
        lines.push("");
    }

    return lines.join("\n");
}
