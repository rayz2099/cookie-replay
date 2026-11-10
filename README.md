# Cookie Relay

> Seamlessly save, copy, and replay cookies across development environments. Zero build required (Manifest V3).

[English](#english) | [中文说明](#中文说明)

---

<a name="english"></a>
## English

### Quick Start

#### 1. Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `cookie-relay` folder.

#### 2. How to Use

- **Export / Save Cookies**
  1. Open your target website (e.g. production or test environment).
  2. Click the **Cookie Relay** extension icon in your toolbar.
  3. Filter, check/uncheck cookies, or rename them as needed.
  4. Click **Save Snapshot** to store locally, or **Copy JSON** to copy to clipboard.

- **Import / Replay Cookies**
  1. Navigate to your destination tab (e.g. `http://localhost:3000`).
  2. Click the extension icon.
  3. Either select a saved snapshot from the **Saved** tab, or go to the **Import** tab and paste JSON from clipboard.
  4. Choose your conflict strategy (**Skip** or **Overwrite** existing cookies).
  5. Click **Import to Tab**.

### Features

- ⚡ **Zero Build**: Pure HTML/CSS/JavaScript, native Manifest V3.
- 📋 **Snapshot & Clipboard**: Save named snapshots locally or copy/paste portable JSON.
- 🔄 **Cross-Environment Replay**: Easily migrate cookies from staging/prod to localhost.
- 🏷️ **Rename & Manage**: Filter, search, rename, and delete cookies on the fly.
- 🛡️ **Privacy First**: All snapshots are stored locally in your browser (`chrome.storage.local`).

### License

[MIT](LICENSE) © 2026 rayz2099

---

<a name="中文说明"></a>
## 中文说明

### 快速开始

#### 1. 安装步骤

1. 克隆或下载本项目源码。
2. 打开 Chrome 浏览器，访问 `chrome://extensions`。
3. 开启右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择本项目的 `cookie-relay` 目录。

#### 2. 使用方法

- **导出与保存 Cookie**
  1. 打开目标网站（如线上或测试环境）。
  2. 点击浏览器工具栏的 **Cookie Relay** 图标。
  3. 自由搜索过滤、勾选需要的 Cookie，或直接重命名。
  4. 点击 **保存快照** 留存在本地，或点击 **复制 JSON** 复制到剪贴板。

- **导入与回放 Cookie**
  1. 打开目的页面（如 `http://localhost:3000`）。
  2. 打开插件弹窗。
  3. 在 **已保存** 标签页选择已有快照，或进入 **导入** 标签页粘贴 JSON。
  4. 选择冲突处理策略（**同名跳过** 或 **同名覆盖**）。
  5. 点击 **导入当前 Tab** 即可完成注入。

### 主要功能

- ⚡ **免编译构建**：纯原生 HTML/CSS/JavaScript，基于 Chrome Manifest V3。
- 📋 **快照与剪贴板**：支持本地命名快照管理与一键 JSON 复制/粘贴迁移。
- 🔄 **跨环境迁移**：轻松将线上/测试环境 Cookie 同步到本地调试环境。
- 🏷️ **便捷管理**：支持快速搜索、全选/反选、就地重命名与删除。
- 🛡️ **本地安全**：数据仅存储于浏览器本地存储（`chrome.storage.local`），不上传任何外部服务器。

### 开源协议

[MIT](LICENSE) © 2026 rayz2099
