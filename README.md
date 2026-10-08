# OI-Code

**为 OIer（信息学奥赛学生）打造的跨平台一体化 IDE。**

开箱即用的 C++ / Python 编辑、编译、运行与评测环境；对拍、评测机、内置浏览器、计时器等 OI 常用工具全部内置在侧边栏，写题、调题、测试不用离开一个窗口。

> 当前状态：编辑器、编译运行、工具链环境与 OI 工具集已交付；Windows 便携版可直接打包运行。
> 架构约束、编码规范与开发流程见 [`AGENTS.md`](./AGENTS.md)。

---

## 功能特性

### 编辑器

- Monaco 内核，C++ / Python 深度支持，内置语言全量注册（任意文件尽量匹配高亮）
- 括号按层级着色并显示配对连接线
- 无扩展名文件按内容自动识别 C++ / Python（并提示补后缀）
- 字号 / 制表符宽度可在设置中调整，编辑器内 `Ctrl+滚轮` 直接缩放
- 标签页与脏标记；`Ctrl+S` 保存、`Ctrl+O` 打开、`Ctrl+N` 新建

### 编译与运行

- 首次启动自动配置环境：自动搜索本机 g++ / Python（先常规搜索，仍缺失且为安装版时全盘强力搜索）；全部检出只在右下角提示「环境已自动配置」，未检出则弹窗给出 MSYS2 / MinGW-w64 / WinLibs 与 python.org 等官方下载地址
- 编译复用本机 g++，标准与自定义编译选项可配置；`F12` 编译、`F10` 运行、`F11` 编译并运行
- 工具链自动搜索（PATH、常见安装目录、MSYS2 / MinGW / Dev-Cpp 等），也可「强力搜索」全盘扫描
- 多编译器 / 多 Python 解释器候选列表，点选即切换默认
- 输入时实时语法检查，问题面板按 `行 | 列 | 原因` 展示并可跳转

### 自动保存

- 每 10 秒静默保存脏文档到临时目录，正常退出自动清理
- 进程崩溃 / 断电后重启检测草稿，原文件未被修改时提示一键恢复

### OI 工具箱（侧边栏）

- **简易评测机**：测试点可手动粘贴添加、编辑、删除；支持导入文件夹或 zip 压缩包，自动按同前缀配对 `.in/.out`、`.in/.ans`、`.input/.output`；可设时间与内存限制，一键编译并对全部测试点评测，逐点给出 AC / WA / TLE / MLE / RE / CE 与耗时、内存
- **对拍**：选择数据生成器、标准程序与待测程序，逐轮生成数据比对输出；发现不一致时展示该轮输入与两侧输出
- **内置浏览器**：默认洛谷首页，Cookie / 登录态持久化；主题支持跟随系统 / 跟随 OI-Code / 亮色 / 暗色
- **计时器**：正计时与倒计时

### VJudge 远程评测（活动栏独立入口）

- 在应用内登录 VJudge（复用内置浏览器登录态，不保存任何账号密码），顶部显示登录用户与已通过题数
- 输入 OJ 与题号即可抓题：OJ 支持模糊匹配（`CF` / `洛谷` / `code`…，已停站单独标注），题面下载后以 Markdown 渲染并显示时限与内存
- 题面顶部一键提交到远端 OJ：语言下拉取自该 OJ 的真实语言表；提交前可先用本地测试点跑一遍评测机（未全通过会先提示，可在设置中关闭）
- 判题结果自动回爬：右下角实时刷新 AC / WA / TLE / MLE / RE 与耗时、内存，并保留该题我的提交记录
- 接口细节、登录需求矩阵与风险说明见 [`VJUDGE.md`](./VJUDGE.md)

### 界面与预览


- 分屏：Markdown / HTML 文件实时预览；打开两个代码文件时变为双编辑器并排，保存与编译跟随焦点所在的一侧
- Markdown 预览支持 GitHub 风格表格与 KaTeX 公式（`$…$` / `$$…$$`，也认 `\(...\)` 与 `\[...\]`），代码块使用 Monaco 语法高亮
- 侧边栏无级伸缩、拖到最窄自动折叠、窄宽度下内容自适应
- 模板系统：内置模板可编辑、隐藏与恢复；`+` 菜单固定提供无后缀「文件」项；`Ctrl+N` 使用的模板可在设置中选择
- 亮 / 暗主题（跟随系统），全部样式基于统一设计令牌

---

## 技术栈

| 层面 | 选型 |
|------|------|
| 语言 | TypeScript（strict） |
| 桌面 | Electron |
| 编辑器 | Monaco Editor |
| UI | React |
| 构建 | Vite（开发）+ esbuild（生产） |
| Monorepo | Nx |
| 规范 | ESLint Flat Config + Prettier + Husky |
| 测试 | Vitest（单元）+ Playwright（E2E） |
| 包管理 | pnpm |

---

## 目录结构

```
apps/desktop      Electron 入口（主进程、preload、渲染进程装配）
libs/base         无依赖基础设施（事件、URI、Disposable、错误处理）
libs/platform     服务契约、IPC 协议、平台服务实现
libs/editor       Monaco 集成与语言服务
libs/workbench    工作台 UI（侧边栏、标签栏、工具箱、设置、分屏）
tools/scripts     构建、打包、分层校验脚本
```

分层依赖单向：`Code → Workbench → Editor → Platform → Base`，任何越层引用都会被 `valid-layers-check` 拦截。

---

## 环境要求

### 开发环境

| 依赖 | 要求 | 说明 |
|------|------|------|
| Node.js | >= 20（推荐 LTS） | 运行时 |
| pnpm | 12.x | 仓库已在 `packageManager` 固定版本，`corepack enable` 自动供给 |
| Git | 任意近版本 | 版本控制与提交钩子 |

### 运行环境（编译题解所需）

- **C++**：任意 `g++`（推荐 MSYS2 / MinGW-w64 / Dev-Cpp / WinLibs）
- **Python**：3.8 及以上

应用内「设置 → C++ 编译器 / Python 解释器」会自动搜索；找不到时可用「强力搜索」全盘扫描，或手动指定。

### 可选工具

- `gdb`：调试功能规划中
- `ninja` / `cmake`：外部构建场景（本项目自身构建不依赖）

---

## 快速开始

```bash
corepack enable                  # 启用 packageManager 指定的 pnpm
pnpm install                     # 安装依赖
pnpm exec nx run desktop:serve   # 开发模式启动
```

首次启动后建议进入「设置」执行一次 C++ / Python 搜索，或直接在编译时由应用自动搜索。

---

## 构建与打包

```bash
pnpm exec nx run desktop:build     # 生产构建，输出 dist/desktop
pnpm exec nx run desktop:package   # Windows 便携打包，输出 release/oi-code-win32-x64/OI-Code.exe
```

打包产物免安装，双击即可运行。配置、浏览器 Cookie 与自动保存草稿保存在系统用户数据目录中。

---

## 测试与校验

```bash
pnpm lint                          # ESLint + Prettier
npm run valid-layers-check         # 分层依赖校验
npx nx run-many -t test --all      # 全量单元测试（Vitest）
pnpm typecheck                     # 全仓 TypeScript 类型检查
npx nx run desktop:e2e             # Playwright E2E（对构建产物）
```

对打包产物复跑同一套 E2E（PowerShell）：

```powershell
$env:OI_E2E_EXECUTABLE='release/oi-code-win32-x64/OI-Code.exe'
pnpm exec nx run desktop:e2e
```

---

## 常见问题

**Electron / Playwright 二进制下载失败（国内网络）**

```powershell
# Electron 二进制走 npmmirror
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

Playwright 浏览器可从 `https://cdn.npmmirror.com/binaries/playwright` 手动下载，解压到 `%LOCALAPPDATA%\ms-playwright\<name>-<rev>\` 并创建空文件 `INSTALLATION_COMPLETE`；升级 Playwright 后 revision 变化需重新安装。

**找不到 `make`**

MinGW 环境通常提供的是 `mingw32-make`，本项目自身不依赖 `make`。

**重新触发首次启动环境自检**

自检成功后会在渲染进程 `localStorage` 写入 `oi-code.environment-bootstrap.done`，因此只在首次启动跑一遍；清除该键（或清空用户数据目录）即可重新自检，也可随时在「设置 → C++ 编译器 / Python 解释器」手动搜索。

```powershell
$env:OI_AUTO_FORCE_SEARCH='1'   # 开发模式允许自动全盘强力搜索（打包版默认允许，无需设置）
$env:OI_SKIP_ENV_BOOTSTRAP='1'  # 完全跳过启动自检（E2E 默认注入，避免弹窗干扰用例）
```

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [`AGENTS.md`](./AGENTS.md) | 架构铁律、编码规范、分支策略、标准工作流、常用命令 |
| [`ICON_GUIDE.md`](./ICON_GUIDE.md) | 图标规范（FontAwesome 唯一来源，禁止 emoji） |
| [`UI_DESIGN.md`](./UI_DESIGN.md) | 视觉方向、设计令牌与交互语言 |
| [`VJUDGE.md`](./VJUDGE.md) | VJudge 接口参考（题面 / 翻译 / 提交 / 记录）与落地实现说明 |
| [`NEXT_UPDATE.md`](./NEXT_UPDATE.md) | 最近一批功能交付记录 |
| [`.agents/`](./.agents/) | 架构守卫、代码生成器、代码审查员子代理说明 |

---

## 许可

ISC（见 `package.json`）。
