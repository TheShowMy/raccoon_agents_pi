import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface RequirementInfo {
    feature: string;
    description?: string;
    acceptance?: string[];
    constraints?: string[];
    loginMethod?: string;
    rememberMe?: string;
}

interface SelectOption {
    label: string;
    value: string;
}

// 动态生成追问选项
function getMissingQuestions(info: RequirementInfo): { field: keyof RequirementInfo; question: string; options: SelectOption[] } | null {
    if (!info.feature) {
        return null;
    }

    // 检测登录相关需求
    const isLoginRelated = /登录|登陆|Login|Signin|Auth/i.test(info.feature + (info.description || ""));
    if (isLoginRelated && !info.loginMethod) {
        return {
            field: "loginMethod",
            question: "登录方式你倾向哪种？",
            options: [
                { label: "📧 邮箱 + 密码", value: "email_password" },
                { label: "🔑 第三方登录（GitHub / Google / 微信等）", value: "oauth" },
                { label: "📧🔑 两种方式都要", value: "both" },
                { label: "❓ 我还没想好，浣熊帮我建议", value: "suggest" },
                { label: "其他...", value: "other" },
            ],
        };
    }

    if (isLoginRelated && info.loginMethod && !info.rememberMe) {
        return {
            field: "rememberMe",
            question: '"记住我"功能需要吗？（保持登录状态）',
            options: [
                { label: "✅ 需要，保持 7 天", value: "7days" },
                { label: "✅ 需要，保持 30 天", value: "30days" },
                { label: "❌ 不需要，每次重新登录", value: "no" },
                { label: "❓ 你建议呢？", value: "suggest" },
                { label: "其他...", value: "other" },
            ],
        };
    }

    // 通用：缺少描述
    if (!info.description) {
        return {
            field: "description",
            question: "这个功能解决什么问题？给谁用的？",
            options: [
                { label: "终端用户的核心功能", value: "enduser_core" },
                { label: "内部管理/运营工具", value: "admin_tool" },
                { label: "技术优化/性能改进", value: "tech_optimization" },
                { label: "❓ 不太好描述，直接帮我写", value: "suggest" },
                { label: "其他...", value: "other" },
            ],
        };
    }

    // 通用：缺少验收标准
    if (!info.acceptance || info.acceptance.length === 0) {
        return {
            field: "acceptance",
            question: "怎么算这个功能做好了？选几个验收标准：",
            options: [
                { label: "功能可正常使用，无报错", value: "basic_works" },
                { label: "有完整错误处理和用户提示", value: "error_handling" },
                { label: "已编写并运行测试用例", value: "tested" },
                { label: "代码通过 Code Review", value: "reviewed" },
                { label: "已更新相关文档", value: "documented" },
                { label: "❓ 帮我写具体的验收标准", value: "suggest" },
                { label: "其他...", value: "other" },
            ],
        };
    }

    return null;
}

function buildIssueBody(info: RequirementInfo): string {
    const lines: string[] = [];
    lines.push("## 功能描述");
    lines.push(info.feature);
    lines.push("");

    if (info.description) {
        lines.push("## 背景与价值");
        lines.push(info.description);
        lines.push("");
    }

    if (info.loginMethod) {
        lines.push("## 技术方案");
        const methodMap: Record<string, string> = {
            email_password: "邮箱 + 密码登录",
            oauth: "第三方 OAuth 登录",
            both: "邮箱密码 + 第三方登录",
            suggest: "待浣熊建议",
        };
        lines.push(`- 登录方式：${methodMap[info.loginMethod] || info.loginMethod}`);
        if (info.rememberMe) {
            const rememberMap: Record<string, string> = {
                "7days": "记住我（7 天）",
                "30days": "记住我（30 天）",
                no: "不启用记住我",
                suggest: "待浣熊建议",
            };
            lines.push(`- 记住我：${rememberMap[info.rememberMe] || info.rememberMe}`);
        }
        lines.push("");
    }

    if (info.acceptance && info.acceptance.length > 0) {
        lines.push("## 验收标准");
        info.acceptance.forEach((item) => {
            lines.push(`- [ ] ${item}`);
        });
        lines.push("");
    }

    if (info.constraints && info.constraints.length > 0) {
        lines.push("## 约束与边界");
        info.constraints.forEach((c) => lines.push(`- ${c}`));
        lines.push("");
    }

    lines.push("---");
    lines.push("*由 Raccoon Agents（浣熊特工队）自动生成* 🦝");

    return lines.join("\n");
}

function buildIssueTitle(info: RequirementInfo): string {
    const prefix = info.feature.length > 30 ? info.feature.slice(0, 30) + "..." : info.feature;
    return `feat: ${prefix}`;
}

function formatSummary(info: RequirementInfo): string[] {
    const lines: string[] = [""];
    lines.push("┌──────────────────────────────────────────────────────────┐");
    lines.push("│  📋 需求摘要                                              │");
    lines.push("├──────────────────────────────────────────────────────────┤");
    lines.push(`│  功能：${info.feature.padEnd(46)}│`);
    if (info.loginMethod) {
        lines.push(`│  方式：${info.loginMethod.padEnd(46)}│`);
    }
    if (info.description) {
        const desc = info.description.length > 46 ? info.description.slice(0, 43) + "..." : info.description;
        lines.push(`│  价值：${desc.padEnd(46)}│`);
    }
    if (info.acceptance && info.acceptance.length > 0) {
        lines.push(`│  验收：${info.acceptance[0].padEnd(46)}│`);
        info.acceptance.slice(1).forEach((a) => {
            lines.push(`│        ${a.padEnd(46)}│`);
        });
    }
    lines.push("└──────────────────────────────────────────────────────────┘");
    lines.push("");
    return lines;
}

async function askWithOptions(
    ctx: ExtensionContext,
    question: string,
    options: SelectOption[],
): Promise<string | null> {
    const items = options.map((o) => o.label);
    const choice = await ctx.ui.select(question, items);
    if (choice === undefined || choice === null) return null;

    const idx = typeof choice === "string" ? parseInt(choice, 10) : (choice as number);
    if (isNaN(idx)) return null;

    const selected = options[idx];
    if (selected.value === "other") {
        const custom = await ctx.ui.input("请描述你的需求：");
        return custom || null;
    }
    if (selected.value === "suggest") {
        return "suggest";
    }
    return selected.value;
}

async function askMultipleSelect(
    ctx: ExtensionContext,
    question: string,
    options: SelectOption[],
): Promise<string[] | null> {
    const result: string[] = [];
    const remaining = [...options];

    while (remaining.length > 0) {
        const items = remaining.map((o) => o.label);
        const choice = await ctx.ui.select(
            `${question}（已选 ${result.length} 项，选"完成"结束）`,
            [...items, "✅ 完成选择"],
        );

        if (choice === undefined || choice === null) return null;
        const idx = typeof choice === "string" ? parseInt(choice, 10) : (choice as number);
        if (isNaN(idx)) return null;
        if (idx === items.length) break;

        const selected = remaining[idx];
        if (selected.value === "other") {
            const custom = await ctx.ui.input("请描述你的验收标准：");
            if (custom) result.push(custom);
            remaining.splice(idx, 1);
        } else if (selected.value === "suggest") {
            return ["suggest"];
        } else {
            result.push(selected.value);
            remaining.splice(idx, 1);
        }
    }

    return result;
}

export function registerNewiss(pi: ExtensionAPI) {
    pi.registerCommand("newiss", {
        description: "🦝 启动需求收集向导，多轮讨论后创建 Git Issue",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify("newiss 需要交互式 TUI 模式", "error");
                return;
            }

            const info: RequirementInfo = { feature: "" };

            // 第一轮：功能描述
            const feature = await ctx.ui.input("🦝 想做什么？简单说就行～");
            if (!feature) {
                ctx.ui.notify("已取消需求收集", "warning");
                return;
            }
            info.feature = feature.trim();

            // 动态追问，最多 3 轮
            let rounds = 0;
            const maxRounds = 3;

            while (rounds < maxRounds) {
                const next = getMissingQuestions(info);
                if (!next) break;

                let value: string | string[] | null;

                if (next.field === "acceptance") {
                    value = await askMultipleSelect(ctx, next.question, next.options);
                } else {
                    value = await askWithOptions(ctx, next.question, next.options);
                }

                if (value === null) {
                    ctx.ui.notify("已取消需求收集", "warning");
                    return;
                }

                if (value === "suggest") {
                    ctx.ui.notify("已标记为待建议，继续收集其他信息", "info");
                    if (next.field === "acceptance") {
                        info.acceptance = info.acceptance || [];
                    }
                    rounds++;
                    continue;
                }

                if (Array.isArray(value)) {
                    (info as unknown as Record<string, unknown>)[next.field] = value;
                } else {
                    (info as unknown as Record<string, unknown>)[next.field] = value;
                }

                rounds++;
            }

            // 展示摘要
            const summary = formatSummary(info);
            ctx.ui.setWidget("newiss-summary", summary);

            // 最终确认
            const finalOptions = [
                "✅ 直接创建 Issue",
                "💬 补充更多信息",
                "🔄 重新收集",
                "❌ 取消",
            ];
            const action = await ctx.ui.select("需求已整理完毕，请选择下一步：", finalOptions);

            if (action === undefined || action === null) {
                ctx.ui.setWidget("newiss-summary", undefined);
                ctx.ui.notify("已取消", "warning");
                return;
            }

            const actionIdx = typeof action === "string" ? parseInt(action, 10) : (action as number);
            if (isNaN(actionIdx)) {
                ctx.ui.setWidget("newiss-summary", undefined);
                ctx.ui.notify("已取消", "warning");
                return;
            }

            if (actionIdx === 3) {
                ctx.ui.setWidget("newiss-summary", undefined);
                ctx.ui.notify("已取消", "warning");
                return;
            }

            if (actionIdx === 2) {
                ctx.ui.setWidget("newiss-summary", undefined);
                pi.sendUserMessage("/newiss", { deliverAs: "followUp" });
                return;
            }

            if (actionIdx === 1) {
                ctx.ui.notify("请直接输入你想补充的内容，我会追加到需求中", "info");
                return;
            }

            // 创建 Issue
            ctx.ui.setStatus("newiss", "正在创建 Issue...");

            try {
                const title = buildIssueTitle(info);
                const body = buildIssueBody(info);

                const result = await pi.exec("gh", [
                    "issue", "create",
                    "--title", title,
                    "--body", body,
                ], {
                    cwd: ctx.cwd,
                    timeout: 15_000,
                });

                if (result.code === 0) {
                    const url = result.stdout.trim();
                    ctx.ui.notify(`✅ Issue 已创建！${url}`, "info");
                    ctx.ui.setWidget("newiss-summary", [
                        "",
                        "🎉 Issue 创建成功！",
                        `${url}`,
                        "",
                    ]);
                } else {
                    ctx.ui.notify(`创建失败：${result.stderr.slice(0, 200)}`, "error");
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                ctx.ui.notify(`创建异常：${msg}`, "error");
            } finally {
                ctx.ui.setStatus("newiss", undefined);
            }
        },
    });
}
