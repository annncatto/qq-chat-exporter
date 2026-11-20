[![][image-banner]][releases-link]

这是一个帮你把 QQ 聊天记录导出到本地的工具。把它下载到你自己的电脑上，就能直接读取并保存好友和群聊的记录。

它不仅可以导出 HTML、JSON、TXT 和 Excel 等各种你需要的格式，还可以将聊天中发过的图片、视频和表情文件一并下载到本地保存。最最最重要的是，所有读取和解析都在你自己的电脑上完成，项目没有服务器或数据传输，绝对不会把你的聊天记录上传到任何地方。

**[下载][releases-link]** **[使用文档][docs-link]** **[Docker 部署][docker-doc]** **[反馈问题][issues-link]**

[![][github-release-shield]][releases-link]
[![][github-downloads-shield]][releases-link]
[![][github-stars-shield]][stars-link]
[![][github-license-shield]][license-link]

> \[!IMPORTANT]
>
> **Star 一下**，你将第一时间收到 GitHub 上的新版本发布通知哟

## 特性

![会话导出](docs/images/features-1.png)

![多格式与定时导出](docs/images/features-2.png)

![现代化查看器](docs/images/features-3.png)

![资源画廊](docs/images/features-4.png)

## 快速开始

从 [Releases][releases-link] 下载适合当前系统的安装包或 Shell 包。

### Windows 一键安装（推荐）

1. 下载 `QQChatExporter-Installer-*.exe` 并运行
2. 用 QQ 扫码登录
3. 打开 `http://localhost:40653/qce`，选择会话并导出记录

### Shell 模式（Windows / Linux / macOS Apple Silicon 预览）

1. 下载并解压对应平台的 Shell 包。Windows x64 使用 `.zip`，Linux x64 和 macOS Apple Silicon 使用各自的 `.tar.gz`
2. 运行 `launcher-user.bat`（Windows）或 `./launcher-user.sh`（Linux / macOS）
3. 用 QQ 扫码登录，打开控制台打印的一键登录链接，随后可选择会话并导出记录
4. 也可手动访问 `http://localhost:40653/qce`，令牌见控制台输出；在「设置 → 启动」里可开启登录后自动打开浏览器

> \[!NOTE]
> macOS 当前仅提供 Apple Silicon（arm64）预览包，且启动前需要完全退出电脑上的 QQ，详见 [macOS 使用指南][macos-doc]。

### QCE 上游的 Docker 部署

适用于 macOS（含 Apple Silicon）、Linux、Windows，无需安装 QQ 客户端：

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter/docker
docker compose up -d

# 查看登录二维码与 Token
docker logs -f napcat-qce
```

> \[!NOTE]
> Apple Silicon (M1/M2/M3/M4) 通过 Rosetta 模拟运行，首次启动可能稍慢。详见 [Docker 部署指南][docker-doc]。

## 跑团工作台

从 QCE 的概览或侧栏打开「跑团工作台」。

- **从 QQ 导入**。QQ 已连接时，点「从 QQ 导入」，选择会话和时间范围。导出完成后，记录会自动进入工作台。也可以从「会话」或已完成的 JSON 导出任务点「整理」。
- **导入本地记录**。点「导入记录」，可以多选 JSON、JSONL 或 TXT。点「文件 → 打开工程」继续已有的 `.qcelog`。导入和整理本地记录无需登录 QQ。

整理时按 `A` 保留、`S` 排除、`E` 编辑。编辑后按 `Ctrl+Enter` 确认并继续。回头修改已确认的消息时，确认后跳至当前阅读窗的下一条。

整理区沿用 QCE 的聊天气泡样式，支持连续滚动、查找和消息序号跳转。窗口／角色侧栏、章节／回合表可收起；“心流”隐藏周边界面，并可左右或上下分屏独立浏览。

可将多个窗口导入同一份 log，在窗口管理中改名或切换是否纳入成稿。角色按 QQ 号或 UID 统一绑定，修改角色名后作用于所有窗口。填写章节／回合名称并勾选「当前整理」，之后确认或排除的消息会自动归入该项。也可在审阅窗或「编辑 Log」中拖选连续消息后一次归类。触屏上先点「选择范围」再拖选。

勾选“预览”可打开可移动的成稿浮窗；点击预览进入“编辑 Log”，直接修改正文，并按角色、章节筛选。文本采用“【角色】”换行接正文的格式。

工程自动保存在当前浏览器；“文件 → 保存工程”导出的 `.qcelog` 包含原始记录和整理进度，可在其他设备继续。成稿支持 TXT、Markdown 和 HTML。

本地文本导入支持带日期、昵称和 QQ 号的 QQ / TIM 记录。附件保留原始元数据并以文字标记显示，工程文件不包含附件二进制内容。

也可以在 `qce-v4-tool` 中运行 `pnpm build:log-editor`，生成可直接在浏览器打开的 `out/log-editor-standalone.html`，用于只处理本地记录时使用。

## 文档

[![文档](docs/images/docs-banner.png)][docs-link]

## 相关项目

[![ChatLab](docs/images/bento-chatlab.png)](https://chatlab.fun/cn)

<p><a href="https://github.com/Ruoan-486/QCE2Chatlab"><img src="docs/images/bento-qce2chatlab.png" alt="QCE2ChatLab" width="49%"></a><a href="https://github.com/CutrelyAlex/QQChatAnalyzer"><img src="docs/images/bento-qqchatanalyzer.png" alt="QQChatAnalyzer" width="49%"></a><a href="https://github.com/JUSTMONIKA2022/QQ-Chat-AI-Analyzer"><img src="docs/images/bento-qq-chat-ai-analyzer.png" alt="QQ-Chat-AI-Analyzer" width="49%"></a><a href="https://github.com/streetartist/napcat-qce-python"><img src="docs/images/bento-napcat-qce-python.png" alt="napcat-qce-python" width="49%"></a></p>

我们非常欢迎和 QCE 有关的社区项目！如果需要展示您的项目，可以在[这里](https://github.com/shuakami/qq-chat-exporter/issues/new)提一个 issue。

## 贡献者

感谢每一位让 QCE 变得更好的贡献者，也感谢 [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 团队提供的框架支持。参与开发？请阅读[贡献指南](https://shuakami.github.io/qq-chat-exporter/docs/contributing.html)。

<a href="https://github.com/shuakami/qq-chat-exporter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=shuakami/qq-chat-exporter" alt="Contributors" />
</a>

## 许可证

[GPL-3.0][license-link]

<!-- LINK GROUP -->

[image-banner]: docs/images/banner.png
[docs-link]: https://shuakami.github.io/qq-chat-exporter/
[releases-link]: https://github.com/annncatto/qq-chat-exporter-log/releases
[issues-link]: https://github.com/shuakami/qq-chat-exporter/issues
[stars-link]: https://github.com/annncatto/qq-chat-exporter-log/stargazers
[license-link]: LICENSE
[docker-doc]: https://shuakami.github.io/qq-chat-exporter/docs/docker-napcat-deployment.html
[macos-doc]: https://shuakami.github.io/qq-chat-exporter/docs/macos-deploy.html
[github-release-shield]: https://img.shields.io/github/v/release/annncatto/qq-chat-exporter-log?include_prereleases&color=317cfe&labelColor=black&logo=github&style=flat-square
[github-downloads-shield]: https://img.shields.io/github/downloads/annncatto/qq-chat-exporter-log/total?color=317cfe&labelColor=black&style=flat-square
[github-stars-shield]: https://img.shields.io/github/stars/annncatto/qq-chat-exporter-log?color=317cfe&labelColor=black&style=flat-square
[github-license-shield]: https://img.shields.io/badge/license-GPL--3.0-317cfe?labelColor=black&style=flat-square
