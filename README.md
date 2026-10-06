# OI-Code

**为 OIer（信息学奥赛学生）打造的跨平台一体化 IDE。**
多语言（C++ / Python）、环境自动搭建、内置 OI 工具集（对拍、Debug、计时、内存测量）、Markdown + LaTeX 渲染。

架构、规范与工作流见 [`AGENTS.md`](./AGENTS.md)；子代理见 [`.agents/`](./.agents/)。

---

## 一、依赖清单（本机环境核对）

核对方式：`Get-Command <tool>` + `--version`；包管理器连通性：`npm ping`。

### 1. 必需（已就绪 ✅）

| 状态 | 依赖 | 版本 | 用途 |
|------|------|------|------|
| ✅ | Node.js | v24.19.0 | 运行时（要求 ≥ 20 LTS） |
| ✅ | npm | 11.17.0 | 包管理兜底 |
| ✅ | **pnpm** | 12.9.1 | 指定包管理器（AGENTS.md §1） |
| ✅ | corepack | 0.35.0 | pnpm 版本供给 |
| ✅ | Git | 2.55.0.windows.5 | 版本控制（`user.name` / `user.email` 已配置） |
| ✅ | registry | npmjs.org 直连 | `npm ping` PONG ≈1.5s，无需镜像 |

### 2. OI 编译 / 运行环境（已就绪 ✅）

| 状态 | 依赖 | 版本 | 用途 |
|------|------|------|------|
| ✅ | gcc / g++ | 16.1.0（MSYS2 ucrt64） | C++ 题解编译运行 |
| ✅ | gdb | 17.2 | Debug 工具 |
| ✅ | ninja | 1.13.2 | 构建执行 |
| ✅ | mingw32-make | 4.4.1 | 构建执行（替代 `make`） |
| ✅ | cmake | 4.3.3 | 构建配置 |
| ✅ | Python | 3.13.12 | Python 题解 |
| ✅ | Docker | 29.7.2 | 可选：容器化构建 |
| ✅ | winget | 1.29.380 | 备用安装源 |

### 3. 待安装（☐ 未装，可选）

| ☐ | 依赖 | 用途 | 安装命令 |
|---|------|------|----------|
| ☐ | `make` | 通用 make 命令（已有 ninja / mingw32-make 可替代） | `C:\msys64\usr\bin\pacman.exe -S make` |
| ☐ | VS Code · Nx Console | Nx 任务可视化 | `code --install-extension nrwl.angular-console` |

已装 VS Code 扩展：`dbaeumer.vscode-eslint`、`esbenp.prettier-vscode`、cpptools、Python。

不适用、**无需安装**：`valgrind`、`perf`（Windows 平台不可用）。

---

## 二、项目级依赖（待 `package.json` 声明）

> ⚠️ 当前 `package.json` 为空壳（**0 依赖**），以下按 `AGENTS.md` §1 技术栈预估，建仓阶段一次性安装。

### 1. 安装命令（按类分批）

```bash
# 语言与规范
pnpm add -D typescript eslint eslint-config-prettier prettier husky lint-staged

# Monorepo 与构建
pnpm add -D nx @nx/js @nx/electron @nx/eslint @nx/vite vite esbuild

# 测试
pnpm add -D vitest @vitest/coverage-v8 @playwright/test

# 桌面与编辑器/UI（运行时依赖）
pnpm add electron monaco-editor react react-dom
pnpm add -D @types/react @types/react-dom @types/node

# E2E 浏览器二进制（当前 %LOCALAPPDATA%\ms-playwright 未安装）
npx playwright install chromium
```

### 2. 依赖分类速查

| 类别 | 依赖 |
|------|------|
| 语言/规范 | `typescript` `eslint` `eslint-config-prettier` `prettier` `husky` `lint-staged` |
| Monorepo/构建 | `nx` `@nx/js` `@nx/electron` `@nx/eslint` `@nx/vite` `vite` `esbuild` |
| 桌面 | `electron` |
| 编辑器/UI | `monaco-editor` `react` `react-dom` `@types/react` `@types/react-dom` `@types/node` |
| 测试 | `vitest` `@vitest/coverage-v8` `@playwright/test` + `npx playwright install chromium` |
| 分层校验 | 自研脚本 `npm run valid-layers-check`（无需外部包） |

---

## 三、安装后自检

```bash
pnpm -v                    # 应输出 12.9.1+
node -v                    # 应 ≥ v20
pnpm install               # 安装项目依赖
pnpm lint                  # ESLint + Prettier
npm run valid-layers-check # 分层校验（必须通过）
nx affected:test           # 受影响项目单元测试
```

---

## 四、常用命令

```bash
nx run desktop:serve         # 开发模式启动
nx run desktop:build         # 生产构建
nx run desktop:e2e           # E2E 测试
```

完整命令与规则见 `AGENTS.md` §9。
