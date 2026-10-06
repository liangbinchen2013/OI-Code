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
| ☐ | 无 | — | 当前无必需待装项 |

已装 VS Code 扩展：`dbaeumer.vscode-eslint`、`esbenp.prettier-vscode`、`nrwl.angular-console`（Nx Console）、cpptools、Python。

**`make`**：ucrt64 仓库的 `mingw-w64-ucrt-x86_64-make` 只提供 `mingw32-make.exe`，原生 `make.exe` 仅在 msys 环境（`C:\msys64\usr\bin`，不在 PATH）。
已在 PATH 内创建 shim `C:\msys64\ucrt64\bin\make.cmd` → 转发到 `C:\msys64\usr\bin\make.exe`，实测 `make --version` = GNU Make 4.4.1；`ninja` / `mingw32-make` 不受影响。

不适用、**无需安装**：`valgrind`、`perf`（Windows 平台不可用）。

---

## 二、项目级依赖（已安装 ✅ 2026-10-06）

> `package.json` / `pnpm-lock.yaml` 已生成，`pnpm install` 完成，工具链全部验证通过（阶段 1 已建仓，2026-10-06）。

### 1. 已安装清单与版本

| 类别 | 依赖 | 版本 |
|------|------|------|
| 语言/规范 | `typescript` | 6.0.3（阶段 1 由 7.0.2 降级，原因见 §2.2） |
| | `typescript-eslint` / `@eslint/js` | 8.71.1 / 10.0.1 |
| | `eslint` / `eslint-config-prettier` | 10.12.0 / 10.1.8 |
| | `prettier` | 3.9.9 |
| | `husky` / `lint-staged` | 9.1.7 / 17.6.0 |
| Monorepo/构建 | `nx` `@nx/js` `@nx/eslint` `@nx/vite` `@nx/vitest` | 23.2.1 |
| | `nx-electron` | 22.0.0（社区 Electron 插件，替代 404 的 `@nx/electron`） |
| | `vite` / `esbuild` | 8.3.2 / 0.28.2 |
| 桌面 | `electron` | 44.5.1（二进制已下载） |
| 编辑器/UI | `monaco-editor` | 0.57.0 |
| | `react` / `react-dom` | 19.3.0 |
| | `@vitejs/plugin-react` | 6.1.2 |
| | `@fortawesome/*`（svg-core + solid/brands/regular + react-fontawesome） | 7.3.1 / 3.5.0，**项目唯一图标库，见 `ICON_GUIDE.md`** |
| | `@types/react` / `@types/react-dom` / `@types/node` | 19.3.0 / 19.3.0 / 26.6.4 |
| 测试 | `vitest` / `@vitest/coverage-v8` | **4.1.11**（见下方"已知问题"） |
| | `@playwright/test` | 1.63.0 + Chromium 153.0.8010.12（已安装并实测启动成功） |

### 2. 阶段 1 已补齐（2026-10-06）

原"未安装 / 待决"项已全部落地：

| 依赖 / 配置 | 说明 |
|-------------|------|
| `typescript-eslint` 8.71.1 + `@eslint/js` 10.0.1 | TS 源码 lint；配套 `typescript` 降级至 6.0.3 |
| `@vitejs/plugin-react` 6.1.2 | React 渲染层构建（peer `vite ^8` 已满足） |
| `@nx/vitest` 23.2.1 | Nx 推断 `test` 目标（`testMode: run`） |
| `nx.json` / `tsconfig.base.json` / `eslint.config.mjs` / `.prettierrc.json` / `.husky/` / `tools/scripts/` | 工作区配置、提交钩子与校验、构建脚本 |

> **TypeScript 降级决策**：TS 7.0.2 为原生编译器（不提供 JS API），`typescript-eslint` 无法在其上运行；
> 经人类确认降级至 6.0.3，构建链（Vite/esbuild）不受影响。

> **`@nx/electron` 决策记录**：官方包 npm 404 → 经人类确认采用社区插件 `nx-electron@22.0.0`。
> 该包 peer 要求 `@nx/devkit|@nx/workspace ^22`，pnpm 自动装入嵌套 `nx@22.7.12`，故当前 **存在 2 个 nx 版本**（根 23.2.1 / 嵌套 22.7.12）。
> 构建链实际采用 **Vite（dev）+ esbuild（prod）**（AGENTS.md §1）；`nx-electron` 仅保留用于后续打包。

### 3. 关键配置

- **构建脚本白名单**：`pnpm-workspace.yaml` 中 `allowBuilds: {electron, electron-winstaller, esbuild, nx}`。
  pnpm 11+ 已废弃 `package.json` 的 `pnpm.onlyBuiltDependencies`，改用 `allowBuilds`，否则安装报 `ERR_PNPM_IGNORED_BUILDS`。
- **工作区**：`packages` 覆盖 `apps/*`、`libs/*`、`libs/extensions/*`；跨层引用使用 `workspace:*` 依赖 + 包 `exports`
  直连 TS 源码（内部包模式），依赖方向由 `npm run valid-layers-check` 校验。
- **供应链策略**：pnpm 12 对新发布包要求列入 `minimumReleaseAgeExclude`（安装时自动写入），否则不满足最小发布时长策略。
- **Nx daemon**：`nx.json` 设 `useDaemonProcess: false`（本机 daemon 首次启动会挂起，属环境问题）。
- **peer 约束**：`@nx/vitest@23` 要求 `vitest ^3 || ^4`，故 vitest 固定在 4.x（5.x 会产生 peer 冲突）。

---

## 三、网络镜像与已知问题（本机环境）

本机 GitHub / Playwright CDN 直连不可用，二进制下载需走镜像：

| 场景 | 解决方式 |
|------|----------|
| Electron 二进制（GitHub 下载 `fetch failed`） | `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'` 后执行 `node node_modules/electron/install.js` |
| Playwright 浏览器下载器超时 | 根因：Playwright 自定义 DNS **IPv6 优先** + Node happy-eyeballs 组合在本机挂起（已二分复现：IPv4 优先则正常）。绕过方式：用 `curl` 从 `https://cdn.npmmirror.com/binaries/playwright` 手动下载 zip，解压到 `%LOCALAPPDATA%\ms-playwright\<name>-<rev>\` 并创建空文件 `INSTALLATION_COMPLETE` |
| `registry.npmmirror.com/-/binary/playwright` 不可用 | 返回 302 且 Playwright 跟随后仍超时；改用 **`cdn.npmmirror.com/binaries/playwright`**（206 直连 ≈928KB/s） |
| pnpm 安装报 `ERR_PNPM_IGNORED_BUILDS` | 见 §2.3 `allowBuilds` 配置 |

> 升级 Playwright 后需重新执行上述手动安装（revision 变化）。

---

## 四、安装后自检

```bash
pnpm -v                    # 12.9.1
node -v                    # ≥ v20（本机 v24.19.0）
pnpm install               # 幂等安装（须无 ERR_PNPM_IGNORED_BUILDS）

# 工具链验证（2026-10-06 实测通过）
pnpm exec nx --version     # 23.2.1
pnpm exec tsc --version    # 6.0.3
pnpm exec eslint --version # 10.12.0
pnpm exec vitest --version # 4.1.11
pnpm exec esbuild --version# 0.28.2
pnpm exec playwright --version  # 1.63.0（Chromium 153 实测 launch OK）

# 阶段 1 起可用（2026-10-06 实测通过）
pnpm lint                    # ESLint + Prettier
npm run valid-layers-check   # 分层校验
nx affected:test             # 受影响项目单元测试
```

---

## 五、常用命令

```bash
nx run desktop:serve         # 开发模式启动
nx run desktop:build         # 生产构建
nx run desktop:package       # Windows 便携打包（release/oi-code-win32-x64/OI-Code.exe）
nx run desktop:e2e           # E2E 测试（设 OI_E2E_EXECUTABLE 可对打包产物复跑）
```

完整命令与规则见 `AGENTS.md` §9。
