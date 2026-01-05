<p align="center">
  <img src="src/assets/logo.png" width="128" height="128" alt="FlareMail Logo" />
</p>

<h1 align="center">FlareMail</h1>

<p align="center">
  <strong>极简、高效、安全的桌面级邮件阅览伴侣</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.3.4-black?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/Tauri-v2-24c8db?style=flat-square&logo=tauri" alt="Tauri" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 🌟 项目简介

**FlareMail** 是一款基于 [Tauri v2](https://v2.tauri.app/) 构建的跨平台邮件阅览工具。它不只是一个邮件客户端，更是对“极简主义”和“隐私至上”理念的工程实践。我们剥离了多余的社交与营销功能，只为你保留最纯粹、最高效的邮件阅读体验。

## ✨ 核心特性

- 🎨 **极简设计**：沉浸式 UI，采用 Tailwind CSS v4 打造的现代磨砂质感界面。
- 🌓 **双色模式**：深度适配系统主题，支持柔和的深色模式（Dark Mode）。
- 📊 **智能仪表盘**：全局掌控已关联的邮箱账号状态及其统计信息。
- 🔐 **隐私保障**：所有数据本地存储，代码开源透明，拒绝任何后端追踪。
- 🚀 **自动更新**：集成 GitHub API，实时感知新版本发布并提供便捷下载。
- 💻 **全平台支持**：一份 Rust 源代码，完美运行于 Windows、macOS 和主流 Linux 发行版。

## 🛠️ 技术栈

- **前端框架**：[React 19](https://react.dev/) + [Vite 7](https://vitejs.dev/)
- **逻辑引擎**：[Tauri v2](https://tauri.app/) (Rust 驱动)
- **视觉设计**：[Tailwind CSS v4](https://tailwindcss.com/) + [Lucide React](https://lucide.dev/) (图标)
- **状态管理**：React Hooks & Refs
- **版本控制**：GitHub Actions 自动化构建与发布

## 📥 快速开始

### 环境依赖

在开始之前，请确保你的机器已安装：
- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/) (Stable)
- 对应平台的 C++ 编译环境（详见 [Tauri 配置指南](https://v2.tauri.app/guides/getting-started/setup/)）

### 运行开发版本

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev
```

### 构建生产版本

```bash
# 构建本地 Release 版本
npm run tauri build
```

## 🤖 自动化与发布

本项目使用 GitHub Actions 进行持续集成与自动发布。当推送以 `v*` 开头的 Tag 时，系统会自动触发跨平台编译流程，并生成对应的 Release 草稿。

> [!TIP]
> 每次开启应用时，FlareMail 都会静默请求 GitHub API。若发现新版本，你会收到一个精美的 Toast 提醒，点击即可跳转至下载页面。

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 许可协议。

Copyright © 2025 **FlareMail Contributors**. 保留所有权利。
