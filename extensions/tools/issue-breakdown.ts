import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isGitWorkTree, detectGitHost } from '../git-utils.js';
import {
    loadTierConfig,
    getModelTier,
    recommendModelForTask,
} from '../model-tier.js';
import { ok, fail } from './common.js';

export function registerIssueBreakdownTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_issue_breakdown',
        label: 'Issue 拆分',
        description:
            '读取 Issue 详情并提供任务拆分框架，帮助 Agent 将需求拆分为可执行的子任务。支持 GitHub、GitLab。',
        parameters: Type.Object({
            issue: Type.Union(
                [
                    Type.Number({ description: 'Issue 编号' }),
                    Type.String({ description: 'Issue 标题关键词（用于搜索）' }),
                ],
                { description: 'Issue 编号或关键词' },
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;

            if (!(await isGitWorkTree(pi, cwd))) {
                return fail('当前目录不是 Git 仓库。');
            }

            const { host } = await detectGitHost(pi, cwd);

            if (host === 'github') {
                return handleGitHubIssue(pi, ctx, cwd, params.issue);
            }

            if (host === 'gitlab') {
                return handleGitLabIssue(pi, ctx, cwd, params.issue);
            }

            if (host === 'gitee') {
                return fail('暂不支持通过工具获取 Gitee Issue 详情。');
            }

            return fail(
                `无法识别 Git 托管平台（检测到的 remote 平台：${host}）。\n` +
                    '目前支持 GitHub（gh CLI）和 GitLab（glab CLI）。',
            );
        },
    });
}

async function handleGitHubIssue(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    cwd: string,
    issue: number | string,
) {
    const ghCheck = await pi.exec('gh', ['--version'], { cwd, timeout: 3_000 });
    if (ghCheck.code !== 0) {
        return fail('未检测到 gh CLI。');
    }

    let issueNumber: number;
    if (typeof issue === 'number') {
        issueNumber = issue;
    } else {
        const searchResult = await pi.exec(
            'gh',
            ['issue', 'list', '--search', issue, '--state', 'open', '--limit', '5', '--json', 'number,title'],
            { cwd, timeout: 10_000 },
        );
        if (searchResult.code !== 0) {
            return fail(`搜索 Issue 失败：${searchResult.stderr || searchResult.stdout}`);
        }

        let issues: Array<{ number: number; title: string }>;
        try {
            issues = JSON.parse(searchResult.stdout);
        } catch {
            return fail('解析搜索结果失败。');
        }

        if (issues.length === 0) {
            return fail(`未找到包含 "${issue}" 的开放 Issue。`);
        }
        if (issues.length > 1) {
            return fail(
                `找到多个匹配 Issue，请使用编号指定：\n` +
                    issues.map(i => `- #${i.number}: ${i.title}`).join('\n'),
            );
        }
        issueNumber = issues[0].number;
    }

    const viewResult = await pi.exec(
        'gh',
        ['issue', 'view', String(issueNumber), '--json', 'number,title,body,labels,state,url'],
        { cwd, timeout: 10_000 },
    );

    if (viewResult.code !== 0) {
        return fail(`读取 Issue 失败：${viewResult.stderr || viewResult.stdout}`);
    }

    let detail: { number: number; title: string; body: string; labels: Array<{ name: string }>; state: string; url: string };
    try {
        detail = JSON.parse(viewResult.stdout);
    } catch {
        return fail('解析 Issue 详情失败。');
    }

    return formatBreakdown(detail.number, detail.title, detail.body, detail.labels.map(l => l.name), detail.state, detail.url, ctx.model);
}

async function handleGitLabIssue(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    cwd: string,
    issue: number | string,
) {
    const glabCheck = await pi.exec('glab', ['--version'], { cwd, timeout: 3_000 });
    if (glabCheck.code !== 0) {
        return fail('未检测到 glab CLI。');
    }

    let issueIid: number;
    if (typeof issue === 'number') {
        issueIid = issue;
    } else {
        const searchResult = await pi.exec(
            'glab',
            ['issue', 'list', '--search', issue, '--state', 'opened', '--per-page', '5', '--output', 'json'],
            { cwd, timeout: 10_000 },
        );
        if (searchResult.code !== 0) {
            return fail(`搜索 Issue 失败：${searchResult.stderr || searchResult.stdout}`);
        }

        let issues: Array<{ iid: number; title: string }>;
        try {
            issues = JSON.parse(searchResult.stdout);
        } catch {
            return fail('解析搜索结果失败。');
        }

        if (!Array.isArray(issues) || issues.length === 0) {
            return fail(`未找到包含 "${issue}" 的开放 Issue。`);
        }
        if (issues.length > 1) {
            return fail(
                `找到多个匹配 Issue，请使用编号指定：\n` +
                    issues.map(i => `- #${i.iid}: ${i.title}`).join('\n'),
            );
        }
        issueIid = issues[0].iid;
    }

    const viewResult = await pi.exec(
        'glab',
        ['issue', 'view', String(issueIid), '--output', 'json'],
        { cwd, timeout: 10_000 },
    );

    if (viewResult.code !== 0) {
        return fail(`读取 Issue 失败：${viewResult.stderr || viewResult.stdout}`);
    }

    let detail: { iid: number; title: string; description: string; labels: string[]; state: string; web_url: string };
    try {
        detail = JSON.parse(viewResult.stdout);
    } catch {
        return fail('解析 Issue 详情失败。');
    }

    return formatBreakdown(detail.iid, detail.title, detail.description, detail.labels, detail.state, detail.web_url, ctx.model);
}

function formatBreakdown(
    number: number,
    title: string,
    body: string,
    labels: string[],
    state: string,
    url: string,
    model: { provider: string; id: string } | undefined,
) {
    const tierConfig = loadTierConfig();
    const currentModelId = model ? `${model.provider}/${model.id}` : null;
    const currentTier = currentModelId ? getModelTier(tierConfig, currentModelId) : null;

    const lines: string[] = [];
    lines.push(`## Issue #${number}: ${title}`);
    lines.push(`- 状态: ${state}`);
    lines.push(`- 标签: ${labels.join(', ') || '无'}`);
    lines.push(`- URL: ${url}`);
    lines.push('');
    lines.push('### 描述');
    lines.push(body || '（无描述）');
    lines.push('');
    lines.push('---');
    lines.push('### 建议的任务拆分框架');
    lines.push('根据 Issue 内容，可按以下维度拆分子任务：');
    lines.push('');

    const taskDimensions = [
        { key: 'frontend', name: '前端/UI', desc: '页面组件、交互逻辑、样式调整' },
        { key: 'backend', name: '后端/API', desc: '接口设计、数据模型、业务逻辑' },
        { key: 'test', name: '测试', desc: '单元测试、集成测试、E2E 测试' },
        { key: 'docs', name: '文档', desc: 'README、API 文档、CHANGELOG' },
        { key: 'config', name: '配置/部署', desc: 'CI/CD、环境变量、依赖升级' },
    ];

    for (const dim of taskDimensions) {
        const { recommendedTier, routedTier, models, fallback } = recommendModelForTask(
            tierConfig,
            dim.key,
        );
        const tierLabel = routedTier === 'high' ? '高档' : routedTier === 'medium' ? '中档' : '低档';
        const recLabel = recommendedTier === 'high' ? '高档' : recommendedTier === 'medium' ? '中档' : '低档';
        const fallbackNote = fallback ? `（${recLabel}无模型，自动升至${tierLabel}）` : '';
        const modelList = models.slice(0, 3).join(' / ');
        const moreModels = models.length > 3 ? ` 等 ${models.length} 个` : '';

        lines.push(`1. **${dim.name}** — ${dim.desc} ${fallbackNote}`);
        lines.push(`   - 推荐档位：${recLabel} → 实际路由：${tierLabel}`);
        lines.push(`   - 可用模型：${modelList}${moreModels}`);
        if (currentTier && currentTier !== routedTier) {
            lines.push(`   - ⚠️ 当前模型档位为${currentTier === 'high' ? '高档' : currentTier === 'medium' ? '中档' : '低档'}，建议切换至 ${tierLabel} 模型`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('### 执行建议');
    lines.push('- 每个子任务对应一个 feature 分支');
    lines.push('- 优先执行被路由到当前模型档位的子任务');
    lines.push('- 需要切换模型的子任务可单独开启会话并行处理');
    lines.push('');

    return ok(lines.join('\n'));
}
