# OI-Code 图标设计指南（ICON GUIDE）

> 适用范围：应用 UI（编辑器、侧边栏、命令面板、状态栏、提示）、源码中的所有图标与符号。
> 判据地位：与 `AGENTS.md` §4 编码规范配套，`reviewer` 提交前审查必查项。

---

## 1. 两条铁律

1. **禁止使用 emoji 表情。** 界面文本、按钮、提示、tooltip、源码字符串、注释中一律不得出现任何 emoji（含 ✅ ❌ ⚠️ 🚀 📁 ▶️ 😀 等全部 Unicode emoji 区段）。
2. **图标统一使用 Font Awesome Free 系列。** 只允许 `@fortawesome/*` 家族（本项目已安装 v7.3.1）：

| 包 | 用途 | 示例 |
|----|------|------|
| `@fortawesome/free-solid-svg-icons` | **默认选择**：操作、状态、通用对象 | `faPlay` `faBug` `faStopwatch` |
| `@fortawesome/free-brands-svg-icons` | 品牌与技术标识 | `faPython` `faGithub` `faMarkdown` |
| `@fortawesome/free-regular-svg-icons` | 需要"轮廓感"的次级状态（可用集合较小，慎用） | `faFile` `faCircleCheck` |
| `@fortawesome/react-fontawesome` + `@fortawesome/fontawesome-svg-core` | React 渲染层（必须配套） | `<FontAwesomeIcon icon={faPlay} />` |

**除品牌/技术标识外，优先 solid。** 图标库只有这一个来源，不得混用第二套。

---

## 2. 安装与引用

```bash
pnpm add @fortawesome/react-fontawesome @fortawesome/fontawesome-svg-core \
         @fortawesome/free-solid-svg-icons @fortawesome/free-brands-svg-icons \
         @fortawesome/free-regular-svg-icons
```

```tsx
// 只导入用到的图标，禁止 * 全量导入（tree-shaking）
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faStop } from '@fortawesome/free-solid-svg-icons';
import { faPython } from '@fortawesome/free-brands-svg-icons';

export const RunButton = () => (
  <button type="button" aria-label="运行">
    <FontAwesomeIcon icon={faPlay} size="sm" title="运行" />
  </button>
);
```

---

## 3. 禁止事项（reviewer 一票否决）

| # | 禁止行为 |
|---|----------|
| 1 | 在 UI 文本、按钮、提示、tooltip、状态栏、源码字符串/注释中使用 **emoji** |
| 2 | 引入 **非 `@fortawesome/*`** 的图标库（lucide、heroicons、material-symbols、tabler、react-icons 中的非 FA 来源、mdi 等） |
| 3 | 手写内联 `<svg>` path 硬编码图标（品牌 Logo、题目配图等确需自定义的图形除外，须在 PR 说明） |
| 4 | 用字符画/方块/箭头拼装图标（如 `▶` `■` `→` `✓` 等符号充当图标）——符号仅允许出现在文档的纯文本表述中，不进 UI |
| 5 | `import * as icons` / `library.add(...)` 全量注册 |
| 6 | 用 emoji 或文字代替缺失图标（缺图必须去 Font Awesome 找，找不到再提出补充需求） |

> 例外：Markdown/LaTeX **用户内容**里用户自己写的 emoji 不受本规范约束（我们只渲染，不清洗）。

---

## 4. 规范写法

- **颜色**：不写死 `color`，靠 CSS 继承 `currentColor`；主题切换由 CSS 变量控制。
- **尺寸**：`size` 只用 `xs | sm | lg | 2x`；同一行内图标尺寸必须一致。
- **可访问性**：纯装饰图标加 `aria-hidden="true"`；承载语义的图标必须给 `title` 或 `aria-label`。
- **命名**：导入名遵循 FA 原名（`fa + PascalCase`），禁止改别名造成歧义。
- **状态色**：成功/警告/错误用类名（如 `.text-success`）表达，不用彩色 emoji。

---

## 5. OI 场景常用图标对照

| 场景 | 图标（solid 除非注明） |
|------|------------------------|
| 运行 / 停止 | `faPlay` / `faStop` |
| 编译 | `faHammer` |
| 调试 Debug | `faBug` |
| 对拍 | `faScaleBalanced` |
| 计时 | `faStopwatch` |
| 内存测量 | `faMicrochip`（或 brands 无对应时用 solid） |
| 提交答案 | `faCloudArrowUp` |
| 文件 / 文件夹 | `faFileLines` / `faFolderOpen` |
| 设置 | `faGear` |
| 搜索 | `faMagnifyingGlass` |
| C++ / Python / Markdown | brands：`faCode`（C++ 无官方 brand，用 solid `faCode`）/ `faPython` / `faMarkdown` |
| LaTeX | solid `faSuperscript` |
| GitHub / VS Code | brands：`faGithub` / `faVisualstudio` |
| 成功 / 失败 / 警告 | solid `faCircleCheck` / `faCircleXmark` / `faTriangleExclamation` |
| 扩展 / 插件 | `faPuzzlePiece` |
| 终端 | `faTerminal` |

> 图标库没有的（如"对拍专用图"），选语义最近的 solid 图标，**不自造、不用 emoji 顶替**，并在 PR 中说明。

---

## 6. 检查方式（提交前，PowerShell，已实测）

```powershell
# 1) 源码中搜 emoji（无输出即通过；有输出即阻断）
git grep -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{1F000}-\x{1F0FF}]' -- '*.ts' '*.tsx'
# 退出码 1 = 无匹配（通过）；0 = 有匹配（阻断）

# 2) 源码中搜非 Font Awesome 图标库
git grep -nE '(lucide|heroicons|material-symbols|tabler|react-icons|@mdi/)' -- '*.ts' '*.tsx'

# 3) 确认已装依赖（当前应为 7.3.1 全系列）
pnpm ls --depth 0 | Select-String fortawesome
```

> bash 等价：去掉 PowerShell 差异即可，`git grep` 参数一致；`Select-String` 换成 `grep`。
> 当前仓库无 `.ts/.tsx` 源码，1、2 实测均返回"无匹配"。

`reviewer` 审查时：以上 1、2 任一有输出 → 🔴 阻断。

---

## 7. 过渡条款

本指南生效**之前**已存在的文档符号（`AGENTS.md` / `README.md` 中的 ✅ ☐ ⚠️ 等 checklist 记号）暂不追溯清理；**新增内容自本指南生效日起一律遵守**。产品 UI 从第一行代码起即受约束，无过渡期。
