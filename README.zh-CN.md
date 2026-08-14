# ChatPlus

本地优先的 AI 聊天工具：多线程对话、歧义旁路澄清、Markdown 目录树导出、上下文深度控制。

[English](./README.md) · [项目介绍页](https://origin-technology-co-ltd.github.io/chat-plus/zh/)

## 功能

- **多模型配置**：设置中维护多套完整模型凭证（显示名 / API Key / Base URL / 模型），指定全局默认；对话页可按会话切换并记住
- 多轮对话（流式回复）；主线与旁路共用当前会话解析后的模型
- 会话本地持久化（SQLite）
- 自带 API Key，OpenAI 兼容接口（OpenAI / DeepSeek / Ollama 等）
- **歧义旁路澄清（v2）**：框选后右键开旁路；右侧嵌套分栏 + 同级纵向 Tab；双轨纳入勾选；超窗时可归纳压缩
- 导出为**嵌套目录树**（相对路径互链），导出始终为完整旁路树，不受滑动窗口影响
- **上下文深度**：估算 token + 窗口占比显示；可配置自动滑动窗口裁剪（界面仍保留完整历史）
- **界面语言**：仅 en/zh；默认跟随本机环境，可在设置中覆盖并持久化

## 环境要求

- Node.js ≥ 20
- pnpm ≥ 9

## 快速开始

```bash
pnpm install
pnpm dev
```

- 前端：http://localhost:18770
- 后端：http://127.0.0.1:18771

端口集中在 `ports.json`，浏览器与桌面互不抢占：

| 模式 | 前端 | 后端 |
|------|------|------|
| Web（`pnpm dev`） | 18770 | 18771 |
| 桌面（`tauri:dev`） | 18772 | 18773 |
| 桌面正式包 | 内嵌前端（无 Vite 端口） | 18773 |

首次使用请打开「设置」，添加至少一条模型配置并设为默认；可按需调整上下文窗口与裁剪参数。旧版单一 API Key / Base URL / 模型会在首次读取设置时自动迁成默认配置。

## 桌面端

```bash
pnpm tauri:dev
pnpm tauri:build
```

桌面构建会把前端和由 Tauri 托管的后端 sidecar 一起打包，后端监听 `127.0.0.1:18773`。桌面端的 SQLite / 配置写入 `com.origintech.chatplus` 对应的系统应用数据目录，与浏览器开发数据隔离。

CI：Actions → **Desktop build**（`workflow_dispatch` 或推送 `v*` tag）会上传 macOS / Windows / Linux 安装包为 workflow artifacts（暂不发 Release、不签名）。

## 数据目录

浏览器开发模式默认数据库与配置存储在 `./data/chatplus.db`。

可通过环境变量覆盖：

```bash
export CHATPLUS_DATA_DIR=~/.chatplus
pnpm dev
```

## 歧义旁路（v2）

1. 在任意对话栏中**框选**文字后**右键** → 「开旁路」，可选「完整上文」
2. 被延伸栏变窄，右侧出现新栏；同级旁路用**纵向 Tab**切换；可继续嵌套
3. 子窗勾选「纳入父对话」；有子树的窗可「一键纳入全部子孙」
4. 发送时先拼装纳入集，再套滑动窗口；若超窗会询问是否**自动归纳压缩**（拒绝则不发送）
5. 导出写入目录树：`index.md` + `threads/...`，父文档用相对路径指向子旁路

## 导出

- 默认目录：`~/Documents/chatplus/exports/`
- 可在设置中修改目录，或开启「每次导出时询问保存路径」
- 导出始终为**完整旁路树**，不受滑动窗口影响
- front matter 的 `model` 为会话当前选用模型；有归因的助手块含 `model:` 行

## 上下文设置

| 项 | 默认 | 说明 |
|----|------|------|
| 上下文窗口上限 | 128000 | 用于占比显示与预算 |
| 自动滑动窗口 | 开启 | 关闭则发送全量历史 |
| 保留最近轮数 | 20 | 一轮 ≈ 一次用户提问 |
| 目标占用比例 | 0.7 | 在轮数裁剪后再按 token 预算收紧 |

## 开发命令

```bash
pnpm typecheck   # 类型检查
pnpm build       # 构建前后端
```

## 发布 / 镜像

公开 GitHub 镜像由开发仓经 GitHub Actions 白名单快照同步。维护者请参阅 [docs/PUBLISH.md](./docs/PUBLISH.md)（`PUBLIC_REPO_TOKEN` 与 Pages `/docs` 配置）。

## 路线图（未实现）

- 用 LLM 摘要替换主线日常滑动窗口
- 消息级纳入控制 / 上下文检查器
- 按模型覆盖上下文窗口参数
- 多 AI 聊天室（指定 / 自由聊天 / 会议模式）
