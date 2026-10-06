# NEXT_STEP：保存代码 + 代码高亮（阶段 2 第一步）

> 状态：已完成（2026-10-06，待合并 `main`）
> 范围：打开 / 编辑 / 保存本地题解文件 + C++ / Python / Markdown 语法高亮
> **明确不做**：编译与运行（后续独立任务）、多标签页、完整文件树、OI 工具集、暗色主题

> 阶段 2 第二步（编译与运行）的完成情况见文末 §7（2026-10-06）。

---

## 1. 验收标准

- [x] 可通过系统打开对话框或快捷键打开 `.cpp` / `.py` / `.md` 文件并在 Monaco 中编辑
- [x] C++ / Python / Markdown 完成语法高亮（关键字、注释、字符串等 token 正确）
- [x] `Ctrl+S` 保存回原文件；保存状态有右下角状态胶囊反馈（成功绿 / 进行中橙 / 失败红）
- [x] 有未保存修改时关闭窗口必须弹确认，禁止静默丢失
- [x] 渲染进程零 Node API 直调，读写一律经 JSON-RPC；主进程校验消息来源
- [x] `pnpm lint`、`npm run valid-layers-check`、`nx affected:test`、`nx run desktop:e2e` 全绿

---

## 2. 任务分解（按提交粒度）

### 2.1 platform：文件服务契约（`IFileService`）

- `src/common/fs.ts`：`IFileService` 接口 + `createDecorator`，方法先行、实现后置
  - `readFile(uri): Promise<string>`
  - `writeFile(uri, content): Promise<void>`
  - `exists(uri): Promise<boolean>`
- `src/common/ipc/protocol.ts`：补齐 `fs.readFile` / `fs.writeFile` / `fs.exists` 方法常量约定
- 主进程侧实现（node:fs/promises）由 `apps/desktop` 装配，避免 platform 依赖 Electron
- 单元测试：内存桩传输 + `os.tmpdir()` 临时目录真实读写；含错误路径（不存在、无权限）

### 2.2 editor：Monaco 集成与语言注册

- `src/browser/monaco.ts`：Monaco ESM 引导；worker 经 Vite `?worker` 显式注册（`self.MonacoEnvironment`）
- `ILanguageService` 实现：`cpp` / `python` / `markdown` 的扩展名与 Monaco languageId 映射
- Monaco 浅色主题由 workbench 设计令牌生成（映射 `--code-bg`、`--text` 等，禁止硬编码 hex）
- 单元测试：语言注册表增删查（纯逻辑，无 DOM）

### 2.3 workbench：编辑器面板与保存交互

- `src/browser/editorPane.tsx`：React 组件挂载 Monaco，经构造函数/属性接收服务
- `Ctrl+S` 命令（Monaco command 与应用级监听双通道，避免焦点丢失时失效）
- 保存状态胶囊与未保存修改标记；按钮/图标遵守 `ICON_GUIDE.md` 与 `UI_DESIGN.md`
- 关闭确认：主进程拦截 `close` 事件，渲染进程上报脏状态

### 2.4 desktop：打开入口与运行装配

- 主进程注册文件 RPC 方法（只允许访问用户主动选择的路径），`dialog.showOpenDialog` 打开
- 渲染进程 bootstrap 建立 `IFileService` 的 JSON-RPC 代理
- 顶栏最小实现：品牌名 + "打开文件" + "保存"入口；文案 zh/en 成对进 i18n（若本步未落 i18n，则集中登记待办）

### 2.5 测试与文档

- E2E：启动 → 打开 fixture → 断言高亮 token → 修改 → `Ctrl+S` → 读盘断言内容与脏状态清除
- 同步更新 README 的依赖/命令状态与 `NEXT_STEP.md` 完成情况

---

## 3. 执行前待决问题（建议默认值）

| 问题 | 建议默认值 |
|------|------------|
| 单文档还是多标签？ | 单文档（最小可验证），标签页留到后续 |
| 高亮来源：Monaco 内置 basic-languages 还是 TextMate 语法包？ | 内置（离线、零新增依赖） |
| 文件入口：文件树还是系统对话框？ | 系统对话框 + 快捷键；文件树后续 |
| 自动保存？ | 仅手动 `Ctrl+S` |
| i18n 何时引入？ | 本步文案先集中登记，i18n 服务随第二阶段 UI 一并落地 |

---

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| Monaco worker 在 Vite/file:// 下的路径问题 | 构建后跑 E2E 实测高亮；必要时切换自定义 `app://` 协议 |
| 连续 `Ctrl+S` 写入竞态 | 写入串行队列；胶囊显式展示进行中状态 |
| 打开任意路径带来的安全暴露 | 主进程仅接受对话框返回的路径白名单，拒绝任意路径读写 |
| 大文件卡顿 | 本期仅约束提示；性能优化列入后续 |

---

## 5. 完成定义

上述任务全部提交、四项必跑命令全绿、`nx run desktop:e2e` 覆盖"打开 → 编辑 → 保存"闭环后，
在 `main` 上打阶段性说明，并转入"编译与运行"任务。

---

## 6. 完成情况（2026-10-06）

**实现落点**：

| 层 | 文件 | 说明 |
|----|------|------|
| Platform | `src/common/{fs,dialog}.ts`、`src/node/fileService.ts` | `IFileService` / `IFileDialogService` 契约 + Node 实现 + `FileServiceClient` / `FileDialogServiceClient` RPC 代理 |
| Editor | `src/common/{languageService,languages}.ts`、`src/browser/{monacoEnvironment,codeEditor}.ts` | 语言注册表（含单测）、Monaco 按需注册三语言、设计令牌主题、`ICodeEditor` 门面 |
| Workbench | `src/browser/{workbench,editorPane}.tsx`、`strings.ts` | 顶栏 + 空态 + 编辑器面板 + 状态胶囊 + `Ctrl+S`/`Ctrl+O` |
| Code | `apps/desktop/src/main/*`、`src/renderer/main.tsx` | 文件 RPC、访问白名单、原生对话框、关闭确认、渲染进程装配 |

**与计划的差异（均为实现约束下的等价/更优方案）**：

- Monaco 0.57 将子路径导出映射到 `esm/vs/`，导入写为 `monaco-editor/editor/editor.api`；只注册 cpp / python / markdown 三种语言定义，worker 采用 `?worker&inline` 并放行 CSP `worker-src blob:`（file:// 下实测可用）。
- Chromium 会把 `#ffffff` 计算为 `#fff`，主题生成前统一展开为 6 位十六进制。
- 关闭确认由主进程原生对话框完成；脏状态在编辑瞬间同步上报，消除"编辑后立刻关闭"竞态。
- `window.close()`（渲染进程）会绕过可取消的 close 事件，E2E 以原生窗口关闭路径验证。

**验证结果**：`pnpm lint`、`valid-layers-check`、`nx affected:test`、`pnpm typecheck`、`nx run desktop:e2e`（4 用例：打开-高亮-编辑-保存 / 白名单拒绝 / 关闭确认 / 冒烟）全绿；
打包版 `release/oi-code-win32-x64/OI-Code.exe` 以 `OI_E2E_EXECUTABLE` 复跑同一套 E2E 亦全绿。

**遗留待办**：i18n 服务落地前，文案集中于 `libs/workbench/src/browser/strings.ts`；单文档模式、多标签、文件树、大文件性能按计划留待后续。

---

## 7. 阶段 2 第二步：编译与运行（2026-10-06）

**交付内容**（对应用户 7 点要求）：

| # | 要求 | 实现 |
|---|------|------|
| 1 | 编译 / 运行 / 编译并运行按钮 + 快捷键 | 文件栏右侧动作区三个按钮；`F12` 编译、`F10` 运行、`F11` 编译并运行（C++ 与 Python 均适用） |
| 2 | 自动搜索 g++ 并实测 C++ 标准 | 候选（PATH / MSYS2 / MinGW / Dev-C++ / scoop / winget 等）→ 版本探测取最高 → 从 c++98 起逐标准编译探测直到报错（含 c++26 之后的 +3 年未来候选）；设置页展示版本、路径、标准列表与默认标准选择，搜索带旋转动画与逐个探测进度 |
| 3 | 搜索 Python 并输出版本 | `py -0p` / `where python|python3` / 常见安装目录；逐候选探测 `sys.version` 与真实路径并去重排序；设置页单选默认解释器 |
| 4 | pip 中文化安装 | 设置页输入包名 / 版本（可选）/ 清华源开关（默认开启）→ `python -m pip install` 实时流式输出到日志区 |
| 5 | 黑窗口运行与统计 | 独立控制台窗口：`T1.exe \| CPU:xxms \| Mem:x.xMB` 状态行钉底 20Hz 刷新（VT 滚动区域；不支持 VT 时回退窗口标题），结束打印 `--------------`、运行时间、峰值内存、CPU 时间、非零退出码，最后"按任意键退出"（`OI_RUNNER_NO_PAUSE=1` 可跳过） |
| 6 | C++ 编译错误面板 + 实时检查 | 问题面板按 `行 \| 列 \| 原因` 展示（无位置错误如链接错误显示 `- \| -`），点击跳转；编辑器 marker 同步；输入停止 700ms 后经 `g++ -fsyntax-only`（stdin）实时检查，过期结果丢弃 |
| 7 | Python 错误检测 | 实时 `compile()` 语法检查（子进程 stdin 传入，不执行用户代码），行列与消息映射为 marker 与问题面板条目 |

**分层落点**：

| 层 | 文件 | 说明 |
|----|------|------|
| Platform | `src/common/{config,diagnostics,toolchain,python,runner}.ts`、`*ServiceClient.ts`、`src/node/configService.ts`、`ipc/protocol.ts` | 契约 + RPC 方法/通知常量 + 渲染进程代理 + JSON 配置存储（临时文件原子替换） |
| Code | `apps/desktop/src/main/{processRunner,runnerService,oiRunnerSource,toolchainService,cppDiagnostics,pythonService,configKeys}.ts`、`mainProcess.ts` | 进程执行、OI 运行器（C++ 包装器源码内嵌、g++ 编译缓存 + 源码哈希失效）、g++ 搜索/标准探测/编译、诊断解析、Python/pip；RPC 注册与线格式序列化 |
| Editor | `src/browser/codeEditor.ts` | `setMarkers` / `revealPosition`（Monaco owner `oi-code`） |
| Workbench | `src/browser/{workbench,tabBar,problemsPanel,settingsView,strings}.tsx`、`workbench.css` | 动作区、问题面板、设置页三大面板、快捷键、实时诊断调度（防抖 + 令牌） |

**关键实现决策**：

- 编译使用**同目录临时源文件**（`<name>.oi-code-tmp.cpp`），不覆盖用户文件、保证 `#include "..."` 相对路径成立，编译后清理；可执行文件与源文件同目录同名（Windows `.exe`）。
- 首次编译/运行时若未配置工具链会自动搜索一次（无果不反复重试，设置页"重新搜索"可强制重试）。
- 运行器由检测到的 g++ 用 `-O2 -municode -static -lpsapi` 编译并缓存于 userData，源码哈希变化自动重编；运行器自行 `AllocConsole` 兜底、UTF-8 控制台。
- 编译/运行环境自动把编译器 bin 目录前置到 PATH（MSYS2 运行时 DLL 可被目标程序找到）。

**验证结果**：`pnpm lint`、`valid-layers-check`、`nx affected:test`、`pnpm typecheck`、`nx run desktop:e2e`（13 用例：原有 8 + C++ 编译成功/F11 运行、编译错误行列原因、Python 检查、设置页搜索、实时诊断）全绿；打包版 `OI-Code.exe` 以 `OI_E2E_EXECUTABLE` 复跑同一套 E2E 待最终确认。

**遗留待办**：

- 工具链实现暂放在 `apps/desktop/src/main`（Code 层）；Extension Host（阶段 6）落地后应迁移至 `libs/extensions/cpp` / `libs/extensions/python`，经 Platform 契约访问编辑器与工作台。
- 实时检查目前是编译级诊断；更完整的补全/语义分析（clangd / Pylance 类）留待后续。
- pip 安装因依赖网络未纳入 E2E（UI 与参数构造已由单测覆盖）。

---

## 8. 体验迭代：自定义编译 / 双层侧边栏 / 模板 / OI 工具箱（2026-10-06）

**交付内容**：

| # | 要求 | 实现 |
|---|------|------|
| 1 | 运行器去掉启动提示 | 控制台不再打印"正在运行 xxx"；底行状态与结束统计不变 |
| 2 | 自定义编译指令 | 设置页 C++ 区块新增"自定义编译选项"输入（如 `-std=c++11 -Wall`，支持引号片段），保存后追加到编译与实时检查（`g++ -fsyntax-only`）；解析单测 + 真实 g++ 集成用例（`-D` 宏生效/清除后报错） |
| 3 | 双层侧边栏 | 左侧 48px 活动栏（资源管理器 / OI 工具箱 / 设置），右侧面板区承载二级视图；设置整页竖排进侧边栏（不再覆盖主区） |
| 4 | 侧边栏拖拽 | 面板与主区之间 5px 手柄可拖拽（180–480px 夹取），宽度持久化到 localStorage |
| 5 | 默认模板与 `+` 菜单 | `+` 弹模板菜单：内置 C++（`bits/stdc++.h` 骨架）/ Python 骨架 + 用户自定义模板；`Ctrl+N` 直接新建默认 C++ 模板；模板在设置中增删改（localStorage 持久化） |
| 6 | OI 工具箱（三层） | 活动栏 →工具列表→工具内容；首发**计时器**：正计时/倒计时，50ms 刷新、倒计时归零闪烁提示"时间到"；切换视图不卸载，计时不中断 |
| 7 | 门禁 | `AGENTS.md` §6.3 增补 `pnpm typecheck`（人类确认采纳） |

**验证**：`pnpm lint` / `valid-layers-check` / `nx run-many -t test --all` / `pnpm typecheck` / `nx run desktop:e2e`（17 用例，新增活动栏切换与计时器、倒计时、侧栏拖拽持久化、自定义模板新建）全绿；打包版 `OI-Code.exe` 复跑同一套 E2E 全绿。

**修复记录**：侧边栏拖拽手柄因负外边距被主区覆盖导致命中失败，已通过 `position: relative; z-index: 2` 修复（E2E 回归覆盖）。
