# OI-Code UI 设计方向（UI DESIGN DIRECTION）

> **来源**：借鉴 [`UI_DESIGN_REFERENCE.md`](./UI_DESIGN_REFERENCE.md)（Rusin-Note 云剪贴板项目的 UI 设计说明）的视觉语言与交互习惯，
> 结合本项目「Electron + React + Monaco 的 OI IDE」形态改写而成。
>
> **性质：这是"方向"，不是像素级规范。** 规定的是风格取向、设计令牌与交互语言；
> 具体组件的实现细节以代码为准，允许在方向内自由发挥。方向本身需变更时，走 `AGENTS.md` 6.4 的文档确认流程。
>
> 配套文档：图标规范见 [`ICON_GUIDE.md`](./ICON_GUIDE.md)；工程规范见 [`AGENTS.md`](./AGENTS.md)。

---

## 1. 风格定位

| 维度 | 取向 |
|------|------|
| 参照 | 类 ChatGPT 官网风：**浅色、大留白、圆角卡片、克制的强调色** |
| 核心隐喻 | **卡片 + 边缘发光**：可交互元素悬浮时**只做发光，不位移不缩放** |
| 主题 | 浅色 + 暗色**完整交付**：两套令牌在 `tokens.css`，Monaco 主题随令牌生成，顶栏切换并持久化，未手动选择时跟随系统（`prefers-color-scheme`） |
| 密度 | 周 chrome（导航/侧栏/面板头）中低密度、留白充足；**编辑器与数据区可提高密度**——IDE 与网页的差异点 |
| 视觉焦点 | 品牌绿 `#0e8a6d` + 黑绿渐变大标题（空状态页/欢迎页可用） |
| 情绪 | 冷静、专注、少干扰——为长时间刷题服务，不追逐花哨动效 |

---

## 2. 设计令牌（Design Tokens）

**所有颜色只能通过令牌引用，禁止在组件里硬编码 hex**（源项目 20+ 处散落 `#1a7f37` 的教训）。
令牌落点：CSS 变量 `:root`（`libs/workbench` 层统一下发），Monaco 主题由同一批令牌生成。

### 2.1 色彩

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#ffffff` | 页面/窗体背景 |
| `--text` | `#0d0d0d` | 主文字 |
| `--muted` | `#6e6e80` | 次级文字、时间戳、说明 |
| `--link` | `#0e8a6d` | **品牌绿**：链接、主按钮、激活态、图标强调 |
| `--hover` | `#353740` | 深色悬浮（个别场景） |
| `--border` | `#d9d9d9` | 控件边框 |
| `--error` | `#f93a37` | 错误、删除、危险操作 |
| `--card-bg` / `--card-border` | `#f7f7f8` / `#ececec` | 卡片底/边 |
| `--card-head` / `--card-detail` | `#202123` / `#6e6e80` | 卡片标题/明细 |
| `--code-bg` | `#f1f1f3` | 代码块、inline code |
| `--btn-bg` / `--btn-hover` | `#ececec` / `#e3e3e3` | 次级按钮 |
| `--glow-ring` | `rgba(0,0,0,0.12)` | 悬浮/聚焦边框色 |
| `--glow-soft` | `rgba(0,0,0,0.05)` | 聚焦外圈光晕 |
| `--glow-shadow` | `0 2px 8px rgba(0,0,0,0.08)` | 悬浮阴影 |
| `--card-shadow` | `0 4px 16px rgba(0,0,0,0.06)` | 主容器/浮层阴影 |
| `--hero-grad-a` / `--hero-grad-b` | `#0d0d0d` / `#10a37f` | 欢迎页/空态大标题渐变 |

**语义状态色（必须令牌化，禁止散落）**

| 令牌 | 值 | OI 场景 |
|---|---|---|
| `--success` | `#1a7f37` | AC、开关「开」、成功提示 |
| `--warn` | `#9a6700` | TLE/警告、待处理 |
| `--danger-soft` | `var(--error)` | RE、删除、失败 |
| `--heat-l1..l4` | `#bfe6d9` `#7fd0b8` `#2fae8b` `#0e8a6d` | **刷题热力图**（GitHub 风四档，直接复用） |

### 2.2 字体

```css
UI:    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
代码:   Consolas, Monaco, "Courier New", monospace;   /* Monaco 编辑器内用 JetBrains Mono/等宽栈，随 Monaco 主题下发 */
```

| 层级 | 规格 |
|---|---|
| 正文/输入 | 16px（≤640px 仍强制 16px，避免 iOS 聚焦缩放） |
| 导航/列表 | 14px |
| 辅助/时间戳 | 12–13px |
| 面板头 | 12px、`uppercase`、`letter-spacing: 0.5px` |
| 侧栏分组标题 | 11px、`uppercase`、`letter-spacing: 0.05em` |
| 欢迎页 Hero | 34px/700 渐变裁切文字，小窗降至 25–26px |

### 2.3 圆角 / 阴影 / 间距

| 层级 | 圆角 |
|---|---|
| 输入框、按钮 | `10px` |
| 卡片（工具卡、统计卡、列表行） | `12px`（统一收口到令牌 `--radius-card`） |
| 主内容容器 | `16px`（小窗 `10–12px`） |
| 胶囊（导航链接、tag、badge） | `999px` |
| 代码块、编辑器面板 | `8px` |

- 阴影两档：静止 `--card-shadow`、悬浮 `--glow-shadow`；浮层 `0 8px 24px rgba(0,0,0,.18)`。
- 间距按 **4/8px 网格**：卡片内边距 `13–22px`，组件纵向间隔 `8–16px`，版块间隔 `28–48px`。

---

## 3. 布局方向

源项目是「网页」，我们是「桌面 IDE」——**继承它的骨架气质，重排功能分区**：

```
┌──────────────────────────────────────────────┐
│ 文件栏  标签页 + 新建/编译/运行/问题（36px）      │ 吸顶
├───────┬──────────────────────────────────────┤
│ 侧栏   │  编辑器区（Monaco，多标签，全宽）          │
│ 232px │  ── 可拖分隔条（12px，hover 手柄变绿）──   │
│ 资源树 │  预览/输出/对拍 双栏或底部面板            │
│ 底部   │                                       │
│ 设置   │                                       │
└───────┴──────────────────────────────────────┘
```

| 区域 | 方向 |
|------|------|
| 顶栏 | 36px **纯文件栏**：文件标签页（脏标记、关闭按钮）+ 新建 + 编译/运行/编译并运行 + 问题面板开关（带数量角标）；品牌与工具入口不占顶栏 |
| 侧栏 | `232px` 固定左栏：资源管理器（目录树 + 打开文件夹 + 刷新）+ 底部设置入口；窄窗收缩 `56px` 纯图标（激活态改左侧 `inset 3px` 绿条） |
| 问题面板 | 底部控制台风格面板：`行 \| 列 \| 原因` 列表，编译失败自动展开，角标常驻 |
| 设置页 | 独立内容页：外观、文件、C++ 编译器（搜索动画/标准列表）、Python 解释器、pip 安装，居中卡片呈现 |
| 编辑器 | **全宽**，不套 920px 居中卡片——那是网页容器，不是 IDE |
| 卡片化容器 | 保留 `max-width: 920px` 居中卡片，仅用于**内容页**：题解 Markdown/LaTeX 预览、设置页、OI 工具说明 |
| 双栏 | 继承源项目「可拖分隔条」：对拍（标准程序 vs 暴力）、编辑 vs 预览，把手 hover/focus/dragging 变绿加长 |
| 卡片网格 | `repeat(auto-fill, minmax(min(250px,100%),1fr))`——工具卡、题单入口 |
| 断点 | 以 `768 / 640 / 480` 为参考；桌面应用下限**窗口最小宽度 720px**，其下按 ≤768 规则收纳 |
| 安全区 | `env(safe-area-inset-*)` 预留（刘海屏笔记本/平板场景） |

**样式层叠方向**（与源项目同构，落地为 CSS Modules/CSS 变量层）：
令牌 → 基础规则 → 组件样式 → 全局收口（统一圆角 + 悬浮改发光）→ 响应式兜底。

---

## 4. 交互语言

1. **悬浮 = 发光，不动**：`transition: box-shadow .22s ease, border-color .2s, background .2s, color .2s`；
   hover 只加 `--glow-shadow` + `--glow-ring`，**禁止 `translateY/scale`**。全项目 40+ 可交互元素共用这一条。
2. **聚焦双层可见**：`input:focus` → 边框 `--glow-ring` + 外圈 `0 0 0 3px --glow-soft`；
   `*:focus-visible` → `2px solid --glow-ring, offset 2px`；无边框输入（编辑器内）不加光晕。
3. **导航激活**：横向链接 `::after` 2px 下划线 `scaleX(0→1)`、`.24s cubic-bezier(.4,0,.2,1)`，仅选中项常驻；
   侧栏/折叠态改左侧 3px 竖条。
4. **页面/视图切换**：交叉淡入 `0.26s`，回退 `opacity 0→1 + translateY(8px) / 0.28s`。
5. **`prefers-reduced-motion: reduce`**：全部过渡/动画降级为 `none`——每一处动效都要有对应分支。
6. **状态胶囊**：保存/运行状态用右下角色胶囊，三态配色（成功绿 / 进行中橙 / 失败红），`opacity` 渐显 toast。
7. **微交互**：拖拽分隔条 `touch-action:none`；折叠状态记忆（`localStorage`）；删除统一确认。

---

## 5. 组件方向（OI 语境）

| 源项目组件 | 我们的对应物 | 继承要点 |
|---|---|---|
| `.btn` 体系 | 运行/编译/提交/工具按钮 | primary 品牌绿底白字、secondary `--btn-bg`、danger 透明红边→hover 红底、`.btn-sm 5px 12px/13px` |
| `.stat-card` | 运行时间 / 内存占用 / 通过数统计卡 | `标题 + 28px 数字 + 明细`，自适应网格 |
| `.note-list li` 卡片化列表 | 文件列表、提交记录、测试点结果 | `radius 12px + margin-bottom 8px`；选中/置顶行用 `--card-icon-bg` 底 + 发光边 |
| `.ff-switch` 开关 | 设置项开关（对拍配置、主题…） | `46×26`，滑块 20px，选中 `--success`，真实 checkbox + `focus-visible` |
| `.tag-chip` 胶囊 | 语言标签、题目标签、难度徽章 | active 品牌绿实底白字；「全部」用虚线边区分 |
| `.status-badge` | **判题状态徽章**：AC 绿 / WA·TLE 琥珀 / RE 红 | 语义色必须走令牌 |
| 热力图 4 档 | **刷题热力图**（活动页/统计页） | `--heat-l1..l4` 直接复用 GitHub 风 |
| `.share-table` 卡片化表格 | 提交/对拍记录表 | `border-collapse: separate + radius 12px + overflow hidden`；窄窗整表横滚 |
| 浮层/抽屉 | 命令面板、大纲、引用补全 | `fixed` 定位 + `opacity + translateY(-6px) scale(.98)` 入场 160ms，点外/ESC 关闭 |
| 右下按钮列 | 运行/保存/删除悬浮列 | 38px 圆钮 + 胶囊主按钮，`backdrop-filter: blur(4px)` |
| `.home-notice` 公告条 | 环境自检/版本更新提示 | `图标 + 文本`，`role="status"` |

**图标一律走 Font Awesome（见 `ICON_GUIDE.md`），禁止 emoji；文案成对（zh/en）进 i18n。**

---

## 6. 主题与演进策略

- **已交付**：浅色 + 暗色两套令牌（`tokens.css` 的 `:root` 与 `:root[data-theme='dark']`），
  Monaco 浅/暗主题由同一批令牌生成；顶栏切换入口（选择持久化到 `localStorage`），
  未手动选择时跟随 `prefers-color-scheme`——一次整批交付，无半成品中间态。
- 新增颜色 → 两套令牌同时补充，不允许只加单侧；新增组件 → 先确认圆角/阴影/悬浮三要素是否在方向内。
- 源文档 §10 的问题清单（圆角不一致、组件重复定义、语义色未令牌化、触控目标 <44px）是我们的**预防清单**：
  落地时逐条自查，不重蹈。

---

## 7. 无障碍底线

- 图标按钮必有 `title` + `aria-label`，装饰图标 `aria-hidden="true"`；导航 `aria-current="page"`；折叠/下拉 `aria-expanded/haspopup`。
- `focus-visible` 双层保障（outline + glow）；开关用真实 checkbox，键盘可达。
- 触控/点击目标 ≥ 44×44（不足则加透明热区）。
- 长内容限高滚动 + `overscroll-behavior: contain`；三处以上动效都要有 `reduced-motion` 分支。
- 输入字号 16px 起步，小窗不缩。

---

## 8. 方向自查清单（reviewer 提交前过一遍）

- [ ] 颜色全部来自令牌，源码无硬编码 hex（图标库与 Monaco 主题配置除外）
- [ ] 悬浮只发光，无位移/缩放；焦点态可见且有 `focus-visible` 分支
- [ ] 圆角命中 8 / 10 / 12 / 16 / 999 五档，未出现新档位
- [ ] 图标来自 `@fortawesome/*`，全项目无 emoji（`ICON_GUIDE.md` §6 命令实测通过）
- [ ] 动效有 `prefers-reduced-motion` 降级
- [ ] 语义状态色用 `--success/--warn/--error`，未散落 hex
- [ ] 新增文案 zh/en 成对进 i18n
- [ ] 页面/面板结构符合 §3 布局方向（编辑器全宽、内容页才用居中卡片）

---

## 9. 与源文档的差异（明确不照搬的部分）

| 源项目（Rusin-Note） | OI-Code |
|---|---|
| 服务端 Jinja2 + 内联 CSS/JS、无构建 | React + Vite + 组件化，令牌/CSS 变量统一下发 |
| 网页：920px 居中容器为主 | 桌面 IDE：编辑器全宽，居中卡片仅内容页 |
| 仅浅色（暗色半成品） | 浅色首发 + 暗色整批交付策略（§6） |
| 页面清单/表单流/验证码等业务组件 | 不适用；以编辑器、工具面板、判题状态为组件主轴 |

> 源文档 [`UI_DESIGN_REFERENCE.md`](./UI_DESIGN_REFERENCE.md) 已作为**参考素材**纳入仓库；本文件才是本仓库的约束性方向文档。
