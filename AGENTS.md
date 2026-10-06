## 0. 一句话项目定位

**OI-Code：为 OIer（信息学奥赛学生）打造的跨平台一体化 IDE。**
多语言（C++ / Python）、环境自动搭建、内置 OI 工具集（对拍、Debug、计时、内存测量）、Markdown + LaTeX 渲染。

---

## 1. 技术栈速查（不可擅自替换）

| 层面 | 选型 |
|------|------|
| 语言 | TypeScript（strict 模式，禁止 `any`） |
| 桌面 | Electron |
| 编辑器内核 | Monaco Editor |
| UI | React |
| 构建 | Vite（dev）+ esbuild（prod） |
| Monorepo | Nx |
| 规范 | ESLint Flat Config + Prettier + Husky |
| 测试 | Vitest（单元）+ Playwright（E2E） |
| 包管理 | pnpm |

---

## 2. 架构铁律（违反即拒绝合并）

### 2.1 分层依赖（单向，严格）

```
Code → Workbench → Editor → Platform → Base
```

- **Base**：无依赖。基础工具、事件、URI、数据结构。
- **Platform**：仅依赖 Base。文件系统、配置、日志、DI、IPC 协议。
- **Editor**：仅依赖 Base + Platform。Monaco 集成、语言服务。
- **Workbench**：仅依赖 Base + Platform + Editor。UI、贡献点、扩展宿主。
- **Code**：唯一入口层。Electron 主进程、CLI、Server。

**禁止反向依赖。** 任何 import 越层，`npm run valid-layers-check` 必须报错。

### 2.2 多进程隔离

- 扩展 **必须** 运行在 Extension Host 进程。
- 渲染进程 **禁止** 直接调用 Node.js API，一律走 IPC。
- 所有 IPC 通信使用 **JSON-RPC**，协议定义在 `libs/platform/ipc/`。
- **禁止** 使用 `@electron/remote`（已废弃，有安全风险）。

### 2.3 依赖注入

- 每个服务先定义接口 `I{Name}`，再用 `createDecorator` 生成标识。
- 实现类 **只通过构造函数** 接收依赖，禁止 `new` 服务、禁止全局单例。
- 服务在 `Platform` 层注册中心按需注册。

### 2.4 资源生命周期

- 所有持有资源的类 **必须** `implements IDisposable`。
- 所有订阅、监听、定时器、句柄 **必须** 注册到 `DisposableStore`。
- 禁止未处理的 Promise、禁止内存泄漏。

---

## 3. 目录地图（只准往这里放东西）

```
libs/base/          # 无业务逻辑的基础工具
libs/platform/      # 平台服务 + IPC 协议
libs/editor/        # Monaco 集成 + 语言服务
libs/workbench/     # UI 组件 + 功能贡献
libs/extensions/    # 内置扩展（cpp / python / oi-tools / markdown-latex）
apps/desktop/       # Electron 入口
tools/generators/   # 代码生成器
.agents/            # 子代理：定义文件 *.md + 同名目录的说明文档 <name>/README.md
```

**文件粒度规则：**

- `common/` → 跨环境代码
- `browser/` → 依赖 DOM
- `node/` → 依赖 Node API
- `contrib/` → 功能贡献点
- `*.test.ts` → 与源文件同目录

---

## 4. 编码规范（强制）

> **图标规范**：界面与源码禁止 emoji，图标统一使用 `@fortawesome/*` Free 系列，详见 [`ICON_GUIDE.md`](./ICON_GUIDE.md)（`reviewer` 必查项）。

### 4.1 命名

- 接口：`IFileService`
- 实现：`FileService`
- 常量：`UPPER_SNAKE_CASE`
- 私有字段：`_camelCase`

### 4.2 错误处理

- 统一使用 `onUnexpectedError(err)` 上报。
- **禁止** 静默 `catch {}`。
- **禁止** `console.log` / `console.error`，一律用 `ILogService`。

### 4.3 TypeScript

- 开启 `strict`，**禁止** `any`、**禁止** `@ts-ignore`。
- 公共 API 必须有 JSDoc。
- 优先 `interface` 描述契约，`type` 描述联合。

### 4.4 注释

- 只注释“为什么”，不注释“是什么”。
- 禁止无意义注释、过期注释。

---

## 5. 分支策略（极简，按需扩增）

### 5.1 常驻分支（唯一允许长期存在的分支）

| 分支 | 用途 |
|------|------|
| `main` | 稳定发布分支。任何时刻 `main` 必须可构建、可运行、通过全部测试。 |

**除此之外，禁止创建任何常驻分支（如 `develop`、`staging`、`release/*` 长期存在）。**

### 5.2 临时分支（按需创建，用完即删）

**仅在确有需要时创建，且任务完成、合并后必须立即删除。**

| 类型 | 命名 | 何时创建 | 生命周期 |
|------|------|----------|----------|
| 功能分支 | `feat/<short-name>` | 需要隔离开发的较大功能 | 合并到 `main` 后立即删除 |
| 修复分支 | `fix/<short-name>` | 需要隔离验证的缺陷修复 | 合并到 `main` 后立即删除 |   
| 紧急修复 | `hotfix/<short-name>` | `main` 上出现必须立即修复的问题 | 合并到 `main` 后立即删除 |
| 实验分支 | `exp/<short-name>` | 探索性技术验证 | 结论产出后立即删除 |

### 5.3 提交信息（Conventional Commits）

```
feat(workbench): 添加状态栏贡献点
fix(platform): 修复文件服务竞态条件
refactor(base): 事件发射器类型安全重构
docs(arch): 更新分层架构决策记录
test(editor): 补充语法高亮单元测试
```

---

## 6. 标准工作流（Agent 每次任务必须遵循）

### 6.1 开始前

1. 读取本文件 + `.agents/architect.md`。
2. 确认变更位于哪一层，检查依赖方向。
3. 若是新服务 / 新扩展，先调用 `.agents/codegen.md` 生成骨架。
4. **判断是否需要临时分支**：小改动直接在当前分支；较大隔离开发才创建 `feat/*`，用后即删。

### 6.2 编码中

- 每次新增文件，先想清楚：属于哪层？接口是什么？谁注入？谁释放？
- 每次新增依赖，先确认不会破坏分层。

### 6.3 提交前（缺一不可）

```bash
pnpm lint                    # ESLint + Prettier
npm run valid-layers-check   # 分层校验
nx affected:test             # 受影响项目单元测试
```

### 6.4 文档改进反馈（Agent 强制义务）

> **当 Agent 在开发过程中发现本文件、`README.md` 或 `.agents/` 子代理文档存在以下情况时，必须主动向人类提示，不得默默略过：**
>
> - 描述与当前代码事实不符
> - 缺少某条重要规则
> - 某条规则已过时或不再适用
> - 存在歧义、容易误读
> - 有更清晰、更准确的表达方式

**提示格式（Agent 输出时必须包含）：**

```markdown
## 📝 文档改进建议

**目标文件**：AGENTS.md
**问题位置**：第 X 节 / 某段某句
**问题类型**：☐ 事实错误  ☐ 缺失内容  ☐ 过时内容  ☐ 歧义  ☐ 表达优化
**建议动作**：☐ 新增  ☐ 修改  ☐ 删除
**改进理由**：（一句话说明）
**建议内容**：（给出具体文字或 diff）

> ⚠️ 请人类确认：是否采纳？采纳后由谁执行？
```

**判定原则：**

- **新增**：原文未涵盖该内容，且该内容对后续开发有约束力。
- **修改**：原文已有相关表述，但表述不准确、不完整或已过时。
- **删除**：原文某条已不再适用于当前架构或流程。

**Agent 严禁未经人类确认就直接改动本文件或子代理文档。**

---

## 7. 禁止事项（红线清单）

| # | 禁止行为 |
|---|----------|
| 1 | 在 `base/` 层写入任何业务逻辑 |
| 2 | 下层 import 上层代码 |
| 3 | 渲染进程直接调用 Node API |
| 4 | 使用 `@electron/remote` |
| 5 | 使用 `console.log` 调试 |
| 6 | 未注册到 DisposableStore 的资源 |
| 7 | 在 Extension Host 之外运行扩展代码 |
| 8 | 使用 `any` / `@ts-ignore` 绕过类型 |
| 9 | 静默吞异常 |
| 10 | 提交未经 `valid-layers-check` 的代码 |
| 11 | 创建 `main` 之外的常驻分支 |
| 12 | 已合并的临时分支长期保留不删 |
| 13 | 未经人类确认擅自改动本文件或子代理文档 |

---

## 8. 子代理协作（`.agents/`）

| 文件 | 角色 | 何时调用 |
|------|------|----------|
| `.agents/architect.md` | 架构守卫 | 任何结构性变更前/后 |
| `.agents/codegen.md` | 代码生成器 | 新建服务 / 扩展 / 贡献点时 |
| `.agents/reviewer.md` | 代码审查员 | 每次 PR / 提交前自审 |

每个子代理另有同名目录存放说明文档：`.agents/architect/README.md`、`.agents/codegen/README.md`、`.agents/reviewer/README.md`。

**Agent 必须主动调用相关子代理，不得跳过。**

---

## 9. 常用命令

> 以下命令在阶段 1（Monorepo 脚手架）完成后方可执行；当前仅依赖安装类命令（`pnpm install` 等）可用。

```bash
nx run desktop:serve         # 开发模式启动
nx run desktop:build         # 生产构建
nx affected:test             # 仅测试受影响项目
nx run-many -t test --all    # 全量单测
nx run desktop:e2e           # E2E 测试
npm run valid-layers-check   # 分层校验（必须通过）
pnpm lint                    # 代码规范检查
```

---

## 10. 阶段目标（Roadmap 摘要）

| 阶段 | 目标 | 完成标志 |
|------|------|----------|
| 1 | 地基：Monorepo + 分层 + DI + IPC + 空窗口 | 分层校验通过，Electron 可启动 |
| 2 | 编辑器：Monaco + C++/Python 高亮与运行 | 可编辑并运行简单程序 |
| 3 | 环境自动搭建 | 用户零手动配置 |
| 4 | OI 工具集：对拍 / Debug / 计时 / 内存 | 集成到侧边栏 + 命令面板 |
| 5 | Markdown + LaTeX 实时预览 | 写题解一体化 |
| 6 | 扩展系统开放 | 扩展市场雏形 |

---

## 11. 给 AI 代理的最终叮嘱

1. **架构先于功能。** 地基不稳，迭代越快，崩塌越快。
2. **宁可慢，不可乱。** 每次变更都能通过架构守卫与代码审查。
3. **分支保持极简。** `main` 常驻，其余按需创建、用完即删。
4. **发现文档问题，主动提示人类。** 不要默默改，也不要视而不见。
5. **永远站在 OIer 视角。** 每个决策都要回答：这是否让 OIer 更专注、更高效？
6. **有疑问，先停下。** 查阅本文件、`.agents/` 子代理、或询问维护者，不要擅自破坏架构。
