import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import {
    Container,
    type SelectItem,
    SelectList,
    Text,
    Input,
    Spacer,
    matchesKey,
    Key,
} from '@earendil-works/pi-tui';

const CUSTOM_VALUE = '__CUSTOM__';

export function registerClarifySelectTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: 'raccoon_clarify_select',
        label: '方案选择',
        description:
            '当用户需求存在多种实现方案时，通过交互式 TUI 展示选项供用户选择。' +
            '支持方向键导航、回车确认，以及「自定义输入」选项。',
        parameters: Type.Object({
            question: Type.String({
                description: '需要用户确认的问题描述，如「请选择实现方案」',
            }),
            options: Type.Array(
                Type.Object({
                    title: Type.String({ description: '方案标题' }),
                    description: Type.Optional(Type.String({ description: '方案描述' })),
                }),
                { description: '方案列表（至少 2 个）' },
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const { question, options } = params;

            if (!options || options.length < 2) {
                return {
                    content: [{ type: 'text' as const, text: '❌ 至少需要提供 2 个选项。' }],
                    details: {},
                };
            }

            // 构建 SelectList 选项，最后一个为自定义输入
            const items: SelectItem[] = options.map((opt) => ({
                value: opt.title,
                label: opt.title,
                description: opt.description,
            }));
            items.push({
                value: CUSTOM_VALUE,
                label: '✏️  自定义方案（手动输入）',
                description: '以上方案都不满意，自己描述需求',
            });

            const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
                const container = new Container();

                // 顶部边框
                container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

                // 问题标题
                container.addChild(new Text(theme.fg('accent', theme.bold('🤔 ' + question)), 1, 0));
                container.addChild(new Spacer(1));

                // 选项列表
                const selectList = new SelectList(
                    items,
                    Math.min(items.length, 8),
                    {
                        selectedPrefix: (t) => theme.fg('accent', t),
                        selectedText: (t) => theme.fg('accent', t),
                        description: (t) => theme.fg('muted', t),
                        scrollInfo: (t) => theme.fg('dim', t),
                        noMatch: (t) => theme.fg('warning', t),
                    },
                );

                // 自定义输入模式
                let customMode = false;
                const customInput = new Input();
                customInput.onSubmit = (value) => {
                    done(value.trim() || null);
                };
                customInput.onEscape = () => {
                    customMode = false;
                    container.removeChild(customInput);
                    container.addChild(selectList);
                    tui.requestRender();
                };

                selectList.onSelect = (item) => {
                    if (item.value === CUSTOM_VALUE) {
                        // 切换到自定义输入模式
                        customMode = true;
                        container.removeChild(selectList);
                        container.addChild(new Text(theme.fg('muted', '请输入你的方案：'), 1, 0));
                        container.addChild(customInput);
                        tui.requestRender();
                    } else {
                        done(item.value);
                    }
                };
                selectList.onCancel = () => done(null);

                container.addChild(selectList);

                // 帮助文字
                container.addChild(new Spacer(1));
                container.addChild(
                    new Text(
                        theme.fg('dim', customMode ? '↵ 确认  •  esc 返回选项' : '↑↓ 选择  •  ↵ 确认  •  esc 取消'),
                        1,
                        0,
                    ),
                );

                // 底部边框
                container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

                return {
                    render: (w: number) => container.render(w),
                    invalidate: () => container.invalidate(),
                    handleInput: (data: string) => {
                        if (customMode) {
                            if (matchesKey(data, Key.escape)) {
                                customInput.onEscape?.();
                            } else {
                                customInput.handleInput(data);
                                tui.requestRender();
                            }
                        } else {
                            selectList.handleInput(data);
                            tui.requestRender();
                        }
                    },
                };
            }, { overlay: true });

            if (result === null) {
                return {
                    content: [{ type: 'text' as const, text: '用户取消了选择。' }],
                    details: {},
                };
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `✅ 用户选择：${result}`,
                    },
                ],
                details: { selected: result },
            };
        },
    });
}
