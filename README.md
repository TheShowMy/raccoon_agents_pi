# 浣熊特工队 Pi 启动守卫

这是一个本地 pi package，用来在现有项目目录中启动 pi：

1. 绘制“浣熊特工队”启动界面。
2. 检查当前目录是否是 Git 项目。
3. 如果不是 Git 项目，询问是否执行 `git init`。
4. Git 可用后进入聊天界面，并在底部展示 Git 状态面板。

## 使用

开发阶段可以在任意项目目录中运行：

```bash
node /Users/theshow/work/pi/raccoon_agents/bin/raccoon-pi.mjs
```

也可以在本扩展目录中运行：

```bash
npm start
```

如果要安装到某个项目本地，进入目标项目后执行：

```bash
pi install -l /Users/theshow/work/pi/raccoon_agents
```

项目级安装会写入目标项目的 `.pi/settings.json`，不需要全局安装。

## 说明

- 扩展不再检查模型配置，模型由用户进入聊天界面后自行使用 `/login`、`/model` 或配置文件处理。
- 扩展不创建 GitHub 仓库，也不克隆项目；它只面向当前启动目录。
- 非 Git 目录只有在用户确认后才会执行 `git init`。
- Git 初始化失败或用户取消初始化时，扩展会说明原因并退出。
- Git 面板显示分支、同步状态、文件变更计数、模型和上下文摘要。
