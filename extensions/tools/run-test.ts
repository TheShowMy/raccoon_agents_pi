import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ok, fail } from './common.js';

export function registerRunTestTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_run_test',
        label: '运行测试',
        description: '运行项目测试脚本。自动检测 package.json 中的测试命令，也可手动指定脚本名。',
        parameters: Type.Object({
            script: Type.Optional(
                Type.String({
                    description: '要运行的测试脚本名（如 test, test:unit），不指定则自动检测',
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const cwd = ctx.cwd;
            const pkgPath = join(cwd, 'package.json');

            if (!existsSync(pkgPath)) {
                return fail('当前目录没有 package.json，无法检测测试脚本。');
            }

            let pkg: { scripts?: Record<string, string> };
            try {
                pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            } catch {
                return fail('解析 package.json 失败。');
            }

            const scripts = pkg.scripts ?? {};
            const testScriptNames = Object.keys(scripts).filter(
                (k) =>
                    k === 'test' ||
                    k.startsWith('test:') ||
                    k.startsWith('test-') ||
                    k.endsWith(':test'),
            );

            let scriptName = params.script;
            if (!scriptName) {
                if (testScriptNames.length === 0) {
                    return fail(
                        'package.json 中没有检测到测试脚本（test / test:*）。\n' +
                            '如需运行其他脚本，请通过 script 参数指定。',
                    );
                }
                scriptName = testScriptNames.includes('test')
                    ? 'test'
                    : testScriptNames[0];
            }

            if (!scripts[scriptName]) {
                return fail(
                    `package.json 中不存在脚本 "${scriptName}"。\n可用脚本: ${Object.keys(scripts).join(', ')}`,
                );
            }

            const execResult = await pi.exec(
                'npm',
                ['run', scriptName, '--'],
                { cwd, timeout: 60_000 },
            );

            const output = execResult.stdout.trim();
            const errorOutput = execResult.stderr.trim();

            if (execResult.code === 0) {
                return ok(
                    `✅ 测试通过 \`npm run ${scriptName}\`\n\n${output}${errorOutput ? '\n\nstderr:\n' + errorOutput : ''}`,
                );
            }

            return fail(
                `测试失败（退出码 ${execResult.code}）\`npm run ${scriptName}\`\n\n${output}${errorOutput ? '\n\nstderr:\n' + errorOutput : ''}`,
            );
        },
    });
}
