# NEXT_STEP：保存代码 + 代码高亮（阶段 2 第一步）

> 状态：已完成（2026-10-06，待合并 `main`）
> 范围：打开 / 编辑 / 保存本地题解文件 + C++ / Python / Markdown 语法高亮
> **明确不做**：编译与运行（后续独立任务）、多标签页、完整文件树、OI 工具集、暗色主题

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
