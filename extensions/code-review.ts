/**
 * 多角度看代码审核引擎
 *
 * 对 PR diff 进行结构化分析，定义 6 个审核角度，
 * 生成引导当前模型（或后续多模型会话）进行深度审核的框架。
 */

export interface DiffStats {
    totalFiles: number;
    addedLines: number;
    removedLines: number;
    files: FileChange[];
}

export interface FileChange {
    path: string;
    status: 'added' | 'removed' | 'modified' | 'renamed';
    added: number;
    removed: number;
    isTest: boolean;
    isConfig: boolean;
    isLockfile: boolean;
    riskLevel: 'high' | 'medium' | 'low';
}

export interface ReviewAngle {
    id: string;
    name: string;
    icon: string;
    description: string;
    checklist: string[];
    recommendedTier: 'high' | 'medium' | 'low';
    applicable: (stats: DiffStats) => boolean;
}

export interface ReviewReport {
    stats: DiffStats;
    angles: ReviewAngle[];
    activeAngles: ReviewAngle[];
    riskSummary: string[];
}

// ── Diff 解析 ──────────────────────────────────────────────

export function parseDiff(diffText: string): DiffStats {
    const lines = diffText.split('\n');
    const files: FileChange[] = [];
    let currentFile: Partial<FileChange> | null = null;
    let added = 0;
    let removed = 0;

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            if (currentFile) {
                files.push(finalizeFile(currentFile, added, removed));
            }
            const match = line.match(/diff --git a\/(.+) b\/(.+)/);
            currentFile = {
                path: match ? match[2] : line,
                status: 'modified',
            };
            added = 0;
            removed = 0;
        } else if (line.startsWith('new file mode')) {
            if (currentFile) currentFile.status = 'added';
        } else if (line.startsWith('deleted file mode')) {
            if (currentFile) currentFile.status = 'removed';
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            added++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            removed++;
        }
    }

    if (currentFile) {
        files.push(finalizeFile(currentFile, added, removed));
    }

    return {
        totalFiles: files.length,
        addedLines: files.reduce((s, f) => s + f.added, 0),
        removedLines: files.reduce((s, f) => s + f.removed, 0),
        files,
    };
}

function finalizeFile(
    partial: Partial<FileChange>,
    added: number,
    removed: number,
): FileChange {
    const path = partial.path || '';
    const isTest = /\.(test|spec)\.|test\/|tests\/|__tests__|e2e\//i.test(path);
    const isConfig = /\.(json|yaml|yml|toml|config\.|rc\.)|package\.json|tsconfig|eslint|prettier|vite|webpack/i.test(path);
    const isLockfile = /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Gemfile\.lock|Cargo\.lock/i.test(path);

    // 风险评估（优先级：测试文件最低，lockfile/配置中等，业务代码按量分级）
    let riskLevel: 'high' | 'medium' | 'low' = 'low';
    if (isTest) {
        riskLevel = 'low';
    } else if (isLockfile) {
        riskLevel = 'medium';
    } else if (isConfig) {
        riskLevel = 'medium';
    } else if (/\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c)$/i.test(path)) {
        riskLevel = added + removed > 50 ? 'high' : 'medium';
    }

    return {
        path,
        status: partial.status || 'modified',
        added,
        removed,
        isTest,
        isConfig,
        isLockfile,
        riskLevel,
    };
}

// ── 审核角度定义 ──────────────────────────────────────────────

export const REVIEW_ANGLES: ReviewAngle[] = [
    {
        id: 'logic',
        name: '逻辑正确性',
        icon: '🧠',
        description: '检查业务逻辑是否正确，是否存在边界条件遗漏、状态管理错误、算法缺陷等',
        checklist: [
            '所有分支条件（if/else/switch）是否都处理了',
            '循环是否有正确的终止条件，是否会死循环',
            '异步操作是否有正确的错误处理（try/catch、.catch）',
            '数值计算是否考虑了精度、溢出、除零等问题',
            '状态更新是否原子化，是否存在竞态条件',
        ],
        recommendedTier: 'high',
        applicable: () => true,
    },
    {
        id: 'security',
        name: '安全性',
        icon: '🔒',
        description: '检查是否存在安全漏洞：注入、XSS、CSRF、敏感信息泄露、权限绕过等',
        checklist: [
            '用户输入是否做了校验和转义',
            '是否有 SQL/NoSQL/命令注入风险',
            '是否有 XSS（跨站脚本）漏洞',
            '敏感数据（密钥、token、密码）是否硬编码或泄露',
            '权限检查是否在服务端完成，能否被客户端绕过',
            '是否有不安全的反序列化',
        ],
        recommendedTier: 'high',
        applicable: (stats) =>
            stats.files.some(
                (f) =>
                    !f.isTest &&
                    !f.isConfig &&
                    /\.(ts|js|tsx|jsx|py|go|rs|java|php|ruby)$/i.test(f.path),
            ),
    },
    {
        id: 'performance',
        name: '性能',
        icon: '⚡',
        description: '检查是否存在性能瓶颈：不必要的计算、内存泄漏、N+1 查询、大数据量处理等',
        checklist: [
            '循环内是否有可移出的重复计算',
            '是否有嵌套循环导致 O(n²) 复杂度',
            '大数据量时是否有分页/流式处理',
            '是否有内存泄漏（未清理的定时器、事件监听、闭包引用）',
            '数据库查询是否可优化（索引、联表、N+1）',
            '是否有不必要的重渲染/re-render',
        ],
        recommendedTier: 'high',
        applicable: (stats) =>
            stats.files.some(
                (f) =>
                    !f.isTest &&
                    /\.(ts|js|tsx|jsx|py|go|rs|java|cpp|c)$/i.test(f.path),
            ),
    },
    {
        id: 'maintainability',
        name: '可维护性',
        icon: '📐',
        description: '检查代码是否清晰易读：命名、注释、复杂度、重复代码、SOLID 原则等',
        checklist: [
            '函数/变量/类命名是否清晰表达意图',
            '函数是否过长（超过 50 行建议拆分）',
            '是否有重复代码可提取为公共函数',
            '是否遵循单一职责原则',
            '注释是否必要且准确（避免注释和代码矛盾）',
            '类型定义是否完整（TypeScript 类型、接口文档）',
        ],
        recommendedTier: 'medium',
        applicable: () => true,
    },
    {
        id: 'testing',
        name: '测试覆盖',
        icon: '🧪',
        description: '检查是否有足够的测试：单元测试、边界测试、错误路径、 mocking 等',
        checklist: [
            '新增代码是否有对应的单元测试',
            '边界条件是否被测试覆盖',
            '错误路径/异常处理是否被测试',
            '测试是否独立，不依赖外部状态或顺序',
            'Mock 是否合理，是否过度 mock 导致测试无意义',
            '测试命名是否清晰描述了测试场景',
        ],
        recommendedTier: 'medium',
        applicable: (stats) =>
            stats.files.some(
                (f) =>
                    !f.isTest &&
                    /\.(ts|js|tsx|jsx|py|go|rs|java)$/i.test(f.path),
            ),
    },
    {
        id: 'compatibility',
        name: '兼容性',
        icon: '🔌',
        description: '检查是否破坏现有功能：API 变更、类型不兼容、依赖升级影响等',
        checklist: [
            '公共 API 是否有破坏性变更（Breaking Change）',
            '类型定义是否向后兼容',
            '依赖升级是否会导致版本冲突',
            '是否有废弃（deprecated）API 的替代方案',
            '配置文件变更是否影响现有环境',
            '数据库迁移脚本是否正确且可回滚',
        ],
        recommendedTier: 'medium',
        applicable: (stats) =>
            stats.files.some(
                (f) =>
                    f.isConfig ||
                    /\.(d\.ts|api|route|controller|service|model)/i.test(
                        f.path,
                    ),
            ),
    },
];

// ── 生成审核报告 ──────────────────────────────────────────────

export function generateReviewReport(diffText: string): ReviewReport {
    const stats = parseDiff(diffText);
    const activeAngles = REVIEW_ANGLES.filter((a) => a.applicable(stats));

    // 风险摘要
    const riskSummary: string[] = [];
    const highRiskFiles = stats.files.filter((f) => f.riskLevel === 'high');
    const noTestFiles = stats.files.filter(
        (f) => !f.isTest && !f.isConfig && !f.isLockfile && f.added > 20,
    );
    const hasLockfile = stats.files.some((f) => f.isLockfile);

    if (highRiskFiles.length > 0) {
        riskSummary.push(
            `⚠️ 高风险文件 ${highRiskFiles.length} 个：${highRiskFiles.map((f) => f.path).join(', ')}`,
        );
    }
    if (stats.addedLines > 200) {
        riskSummary.push(
            `⚠️ 新增代码 ${stats.addedLines} 行，建议拆分为更小的 PR`,
        );
    }
    if (noTestFiles.length > 0 && !stats.files.some((f) => f.isTest)) {
        riskSummary.push(
            `⚠️ 缺少测试文件：${noTestFiles.length} 个源文件有新增代码但无对应测试`,
        );
    }
    if (hasLockfile) {
        riskSummary.push(
            `📦 依赖变更（lockfile），请检查是否有安全风险或版本冲突`,
        );
    }

    return { stats, angles: REVIEW_ANGLES, activeAngles, riskSummary };
}

// ── 格式化审核框架输出 ──────────────────────────────────────────────

export function formatReviewFramework(report: ReviewReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('🔍 代码审核框架（多角度看代码）');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    // 变更统计
    lines.push(`📊 变更统计：${report.stats.totalFiles} 个文件，` +
        `+${report.stats.addedLines} / -${report.stats.removedLines} 行`);
    lines.push('');

    // 风险摘要
    if (report.riskSummary.length > 0) {
        lines.push('⚠️ 自动识别的风险点：');
        for (const risk of report.riskSummary) {
            lines.push(`  ${risk}`);
        }
        lines.push('');
    }

    // 文件清单
    lines.push('📁 变更文件：');
    for (const f of report.stats.files.slice(0, 20)) {
        const icon = f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : 'M';
        const risk = f.riskLevel === 'high' ? '🔴' : f.riskLevel === 'medium' ? '🟡' : '🟢';
        lines.push(`  ${risk} [${icon}] ${f.path} (+${f.added}/-${f.removed})`);
    }
    if (report.stats.files.length > 20) {
        lines.push(`  ... 等共 ${report.stats.files.length} 个文件`);
    }
    lines.push('');

    // 审核角度
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('📋 审核角度（请逐一检查，每个角度给出结论）');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    for (const angle of report.activeAngles) {
        const tierLabel = angle.recommendedTier === 'high' ? '🔴 高档' : angle.recommendedTier === 'medium' ? '🟡 中档' : '🟢 低档';
        lines.push(`${angle.icon} **${angle.name}** ${tierLabel}`);
        lines.push(`  ${angle.description}`);
        lines.push('  检查清单：');
        for (const item of angle.checklist) {
            lines.push(`    □ ${item}`);
        }
        lines.push('  **结论格式**：✅ 通过 / ⚠️ 需关注（说明原因和代码位置）/ ❌ 不通过（必须修复）');
        lines.push('');
    }

    // 多模型审核建议
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('🤖 多模型审核建议');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('为获得更全面的审核结果，建议按以下方式执行：');
    lines.push('');
    lines.push('**第 1 轮（当前模型）—— 逻辑 + 安全 + 性能（高档深度分析）**');
    lines.push('  重点关注：业务逻辑正确性、安全漏洞、性能瓶颈');
    lines.push('  逐条检查上面 🔴 高档角度的检查清单');
    lines.push('');
    lines.push('**第 2 轮（切换到低档模型）—— 快速扫描**');
    lines.push('  使用 `raccoon_model_config` 查看低档模型，切换后重新分析 diff');
    lines.push('  重点关注：命名规范、代码风格、简单错误、拼写问题');
    lines.push('  低档模型成本低，适合做广撒网式的快速扫描');
    lines.push('');
    lines.push('**第 3 轮（如有需要，切换到另一个中档模型）—— 交叉验证**');
    lines.push('  用不同模型验证关键逻辑，避免单一模型的盲点');
    lines.push('');
    lines.push('---');
    lines.push('请从第一个角度开始，逐一给出审核结论。');
    lines.push('');

    return lines.join('\n');
}

// ── 格式化 diff（截断 + 标注） ──────────────────────────────────────────────

export function formatDiffForReview(diffText: string, maxLines = 300): string {
    const lines = diffText.split('\n');
    const result: string[] = [];

    result.push('```diff');
    if (lines.length > maxLines) {
        result.push(lines.slice(0, maxLines).join('\n'));
        result.push('```');
        result.push(`（省略 ${lines.length - maxLines} 行，请结合审核框架关注关键变更）`);
    } else {
        result.push(diffText);
        result.push('```');
    }

    return result.join('\n');
}
