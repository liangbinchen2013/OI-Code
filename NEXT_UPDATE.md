# NEXT_UPDATE：侧边栏与编辑器体验优化（8 项核心任务）

> 状态：待实施
> 范围：侧边栏交互、分屏预览、括号配对、自动保存、工具链搜索增强
> **明确不做**：除下述 8 点外的任何其他优化

---

## 1. 侧边栏无限制伸缩 + 自动折叠

### 1.1 当前问题
- `layout.ts` 中 `SIDEBAR_MAX_WIDTH = 480` 限制了最大宽度
- 拖拽手柄 `oi-resize-handle` 仅在 180–480px 之间夹取
- 侧边栏内容（资源管理器、设置面板）在宽度不足时会被压缩、按钮消失、文本溢出

### 1.2 目标行为
| 场景 | 行为 |
|------|------|
| **向右拖拽** | 无上限（受限于窗口宽度 - 编辑器最小宽度） |
| **向左拖拽** | 最小 48px（仅活动栏图标） |
| **拖拽至 ≤ 48px** | 自动触发「完全折叠」：侧边栏宽度锁定 48px，仅显示活动栏，面板区隐藏 |
| **折叠态点击活动栏图标** | 临时展开至上次非折叠宽度（或默认 260px），鼠标移出自动折回 |
| **折叠态双击调整手柄** | 恢复至上次非折叠宽度 |

### 1.3 技术实现点
- `layout.ts`：移除 `SIDEBAR_MAX_WIDTH`，改为动态计算 `window.innerWidth - EDITOR_MIN_WIDTH`
- `workbench.tsx`：新增 `isCollapsed` 状态，`sidebarWidth === 48` 时视为折叠态
- `workbench.css`：`.oi-sidebar.collapsed .oi-sidebar-panels { display: none }`，活动栏保持 48px
- 拖拽逻辑：`clampSidebarWidth` 下限改为 48，上限动态；拖拽结束 `< 60` 直接吸附到 48

---

## 2. 侧边栏内容自适应（防压缩丢失）

### 2.1 当前问题
- 设置面板、模板列表、工具链搜索进度等在窄宽度下：按钮被挤出视野、输入框宽度为 0、文本省略不全
- `oi-settings-rows`、`.oi-template-row`、`.oi-python-list` 等使用 `flex-wrap` 但最小宽度未限制

### 2.2 目标行为
| 组件 | 窄宽度策略 |
|------|------------|
| 设置面板各行 | 标签+输入垂直堆叠（`flex-direction: column`），输入框宽度 100% |
| 模板列表 | 编辑/删除图标按钮始终可见，名称省略 |
| Python 解释器列表 | 路径省略，版本+默认徽标保留 |
| 工具链搜索进度 | 单行滚动或 tooltip 显示完整文本 |
| 通用 | `min-width: 0` 允许 flex 子项收缩，配合 `overflow: hidden; text-overflow: ellipsis` |

### 2.3 实现
- `workbench.css`：新增 `@media (max-width: 300px)` 针对 `.oi-sidebar` 的响应式规则
- 关键容器添加 `min-width: 0`，按钮组 `flex-shrink: 0`

---

## 3. 分屏预览（编辑器 + 预览/输出）

### 3.1 需求
- 支持水平/垂直分屏（编辑器左/上，预览或终端输出右/下）
- 分割比例可拖拽调节：1:1 ↔ 3:4 ↔ 自定义
- **光标所在标签页即当前编译/运行目标**（单文档模式下自然满足；多标签页时以活动标签为准）

### 3.2 实现方案
- `workbench.tsx`：新增 `splitDirection: 'horizontal' | 'vertical' | null`、`splitRatio: number (0.2–0.8)`
- 编辑器宿主 `.oi-editor-host` 与预览/输出面板共用父容器，中间插入分割手柄
- 预览面板复用现有 `ProblemsPanel` 结构，或新增 `PreviewPanel`（Markdown/HTML 预览）
- 终端输出面板复用现有编译/运行输出逻辑（主进程已支持黑窗口运行，此处仅做内嵌预览）

### 3.3 交互
- 标签栏右侧新增「分屏」图标按钮 → 切换分屏模式
- 分割手柄拖拽更新 `splitRatio`，持久化到 `localStorage`
- 编译/运行按钮始终针对 `activeTabId` 对应的文件

---

## 4. 括号对着色

### 4.1 目标
- Monaco 编辑器启用 `editor.bracketPairColorization.enabled = true`
- 配合 `editor.guides.bracketPairsHorizontal` 显示连接线

### 4.2 实现
- `libs/editor/src/browser/monacoEnvironment.ts`：`ensureMonacoEnvironment` 中设置
- 可选：`settingsView.tsx` 增加开关（默认开启）

---

## 5. 静默自动保存（防断电丢失）

### 5.1 策略
| 参数 | 值 |
|------|----|
| 触发间隔 | 10 秒 |
| 保存目标 | 临时目录（`os.tmpdir()` / `app.getPath('temp')`） |
| 文件命名 | `{original-name}.{hash}.oi-autosave` |
| UI 提示 | **完全无提示**（无状态胶囊、无 toast、无标题栏脏点） |
| 恢复时机 | 启动时检测临时目录同名文件，若原文件未修改（mtime 对比），提示「检测到未保存草稿，是否恢复？」 |

### 5.2 架构落点
| 层 | 文件 | 说明 |
|----|------|------|
| Platform | `src/common/autosave.ts` | `IAutoSaveService` 接口 + `createDecorator` |
| Platform/node | `src/node/autoSaveService.ts` | Node 实现：定时器、临时文件读写、恢复扫描 |
| Platform/common | `src/common/autoSaveServiceClient.ts` | 渲染进程 RPC 代理 |
| Editor | `codeEditor.ts` | 暴露 `getAllDirtyDocuments()` 供服务轮询 |
| Code | `apps/desktop/src/main/autoSaveService.ts` | 主进程侧实现（有 Node fs 权限） |
| Workbench | `workbench.tsx` | 启动时调用恢复扫描，注册定时保存 |

### 5.3 关键细节
- 仅保存「已打开且有修改」的文档（`dirty === true`）
- 临时文件存储：内容 + 元数据（原始 URI、编码、上次修改时间）
- 程序正常退出时清理对应临时文件
- 非正常退出（进程崩溃、断电）下次启动自动检测

---

## 6. 工具链「强力搜索」（全局扫描 g++.exe / python.exe）

### 6.1 当现状
- `toolchainService.search()` / `pythonService.search()` 仅搜索 PATH、常见安装目录、MSYS2、MinGW、scoop、winget 等已知位置

### 6.2 新增：强力搜索
- **触发方式**：设置面板 C++/Python 区块「自动搜索」按钮旁新增「强力搜索」按钮（图标：`faMagnifyingGlassArrowsRotate` 或类似）
- **提示文案**：`"全局搜索 g++.exe / python.exe，耗时较长（约 10–30 秒），请耐心等待"`
- **搜索范围**：
  - Windows：`C:\`、`D:\` 等固定盘符 + `%USERPROFILE%` + `%PROGRAMFILES%` + `%LOCALAPPDATA%` 递归查找 `g++.exe` / `python.exe`
  - Linux/macOS：`/usr`、`/opt`、`/home`、`/usr/local` 递归查找 `g++` / `python3`
- **验证逻辑**：
  - 执行 `g++ --version` / `python --version`，解析版本号
  - 尝试编译/运行最小测试代码（C++: `int main(){}`，Python: `print(1)`）
  - 去重：同一路径、同版本仅保留一条
- **结果展示**：搜索完成后在设置面板列出所有可用项，用户单选设为默认

### 6.3 实现文件
- `libs/platform/src/common/toolchain.ts`：新增 `forceSearch` 方法签名
- `libs/platform/src/common/toolchainServiceClient.ts`：RPC 代理
- `apps/desktop/src/main/toolchainService.ts`：Node 侧实现（`fs.walk` / `glob` + 子进程验证）
- `settingsView.tsx`：新增按钮、进度显示、结果列表

---

## 7. 多编译器用户选择

### 7.1 当现状
- 搜索到多个 g++ 时，仅自动选择版本最高者作为默认

### 7.2 新增：用户可选
- 搜索完成（普通搜索/强力搜索）后，设置面板以**单选列表**展示所有检测到的编译器
- 列表项显示：版本号、路径、来源（PATH/MSYS2/MinGW/全局搜索）、是否为当前默认
- 用户点击某项 → 立即生效为默认编译器
- 保留「重新搜索」按钮可随时刷新列表

### 7.3 实现
- `IToolchainStatus` 增加 `candidates: IToolchainCandidate[]` 字段
- `settingsView.tsx`：`oi-cpp-standard` 下方改为候选列表渲染

---

## 8. 多 Python 解释器用户选择（同理）

### 8.1 当现状
- 已有解释器列表（`oi-python-list`），支持单选默认解释器

### 8.2 确认
- 现有实现已满足「多 Python 用户选择」需求，**无需额外工作**
- 仅需确保「强力搜索」结果能正确合并到现有列表

---

## 交付清单（按依赖顺序）

| 顺序 | 任务 | 关键文件 | 验收标准 |
|------|------|----------|----------|
| 1 | 侧边栏无限制伸缩 + 自动折叠 | `layout.ts`, `workbench.tsx`, `workbench.css` | 拖拽无上限；≤48px 自动折叠；折叠态点击图标临时展开 |
| 2 | 侧边栏内容自适应 | `workbench.css` | 宽度 180px 时设置面板/模板/工具链无按钮丢失、无溢出 |
| 3 | 分屏预览 | `workbench.tsx`, `workbench.css`, `editorPane.tsx` | 可开启水平/垂直分屏，比例可拖拽，编译针对活动标签 |
| 4 | 括号对着色 | `monacoEnvironment.ts` | 编辑器中括号按层级着色，显示连接线 |
| 5 | 静默自动保存 | `platform: autosave.*`, `editor: codeEditor.ts`, `code: autoSaveService.ts`, `workbench.tsx` | 10s 无感保存到临时目录；崩溃重启提示恢复；正常退出清理 |
| 6 | 强力搜索 g++ | `platform: toolchain.*`, `code: toolchainService.ts`, `settingsView.tsx` | 点击强力搜索 → 全盘扫描 → 验证 → 列表展示可选 |
| 7 | 多 g++ 用户选择 | `platform: toolchain.ts`, `settingsView.tsx` | 搜索结果以单选列表呈现，用户可切换默认 |
| 8 | 多 Python 选择确认 | `settingsView.tsx` | 现有列表功能完善，强力搜索结果正确合并 |

---

## 约束与红线

1. **不引入新依赖包**（仅用现有 `@fortawesome`、Monaco、React、Node APIs）
2. **分层依赖不得破坏**：新服务放 `platform`，主进程实现放 `code`，UI 放 `workbench`
3. **所有资源 `IDisposable`**：定时器、文件监听、RPC 订阅均进 `DisposableStore`
4. **错误统一 `onUnexpectedError`**，禁 `console.*`
5. **TypeScript strict**，无 `any`/`@ts-ignore`
6. **图标仅用 FontAwesome**，禁 emoji
7. **样式复用 `tokens.css` 变量**，禁硬编码颜色
8. **完成前必须通过**：`pnpm lint`、`npm run valid-layers-check`、`nx run-many -t test --all`、`pnpm typecheck`、`nx run desktop:e2e`

---

## E2E 补充用例

| 用例 | 场景 |
|------|------|
| 侧边栏拖拽至 48px 自动折叠 | 拖拽手柄左移至最小，面板消失，仅剩活动栏 |
| 侧边栏折叠态点击图标临时展开 | 折叠态点击 Explorer 图标 → 面板展开 → 鼠标移出 → 自动折回 |
| 侧边栏宽度 200px 时设置面板无丢失 | 设置面板各行垂直堆叠，输入框可见 |
| 分屏拖拽调节比例 | 开启分屏 → 拖拽分割线 → 编辑器/预览比例实时变化 |
| 自动保存恢复 | 编辑文件 → 杀进程 → 重启 → 提示恢复草稿 → 确认 → 内容恢复 |
| 强力搜索 g++ | 点击强力搜索 → 进度显示 → 完成列出所有 g++ → 可切换默认 |

---

## 备注

- 任务 5（自动保存）涉及主进程文件系统访问，**必须在 Code 层实现**，Platform 仅定契约
- 任务 6/7（强力搜索）属于耗时操作，**必须异步 + 进度通知**，UI 不阻塞
- 分屏预览（任务 3）后续可扩展为 Markdown/LaTeX 实时预览（阶段 5 前置）