# Rusin-Note UI 设计说明

> 本文档基于对 `templates/` 全部 Jinja2 模板与 `app/core/theme.py`、`app/core/utils.py` 的静态分析整理，
> 描述当前代码库**实际呈现**的界面设计体系：设计令牌、布局架构、组件、交互、响应式与无障碍。
> 前端无独立 JS/CSS 文件，样式与脚本全部内联在模板中（见 AGENTS.md「前端检查」）。

---

## 1. 设计定位与风格

| 维度 | 结论 |
|---|---|
| 风格参照 | **类 ChatGPT 官网风格**（`app/core/theme.py:4` 注释明确标注），浅色、留白充足、圆角卡片 |
| 主题 | **仅浅色**（`color-scheme: light`），无暗色切换入口 |
| 核心隐喻 | 「卡片 + 边缘发光」——所有可交互元素悬浮时**只做发光，不位移不缩放**（`partials/_card_theme_css.html:49`） |
| 信息密度 | 中低密度，大留白；正文 16px、辅助文字 12–14px 分层清晰 |
| 视觉焦点 | 品牌绿 `--link` + 黑绿渐变大标题（`#0d0d0d → #10a37f`） |
| 实现形态 | 服务端 Jinja2 渲染 + 少量内联原生 JS，无框架、无构建步骤 |

---

## 2. 设计令牌（Design Tokens）

### 2.1 色彩

全部令牌定义在 `app/core/theme.py` 的 `THEME_VARS`，经 `theme_vars` 注入每个页面的 `:root`。

**基础色**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#ffffff` | 页面/编辑器背景 |
| `--text` | `#0d0d0d` | 主文字 |
| `--muted` | `#6e6e80` | 次级文字、时间戳、说明 |
| `--link` | `#0e8a6d` | **品牌绿**：链接、主按钮、激活态、图标强调 |
| `--hover` | `#353740` | 深色悬浮（个别场景） |
| `--border` | `#d9d9d9` | 控件边框 |
| `--error` | `#f93a37` | 错误、删除、危险操作 |

**表面与结构色**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--card-bg` | `#f7f7f8` | 卡片底色 |
| `--card-border` | `#ececec` | 卡片边框 |
| `--card-head` / `--card-detail` | `#202123` / `#6e6e80` | 卡片标题/明细 |
| `--card-icon-bg` | `#ececec` | 图标底、置顶行底、notice 底 |
| `--navbar-bg` / `--navbar-border` | `#ffffff` / `#ececec` | 导航/侧栏/面板头 |
| `--heading-border` / `--list-border` | `#ececec` | 标题下划线、列表分隔线 |
| `--code-bg` | `#f1f1f3` | 代码块/inline code |
| `--input-bg` | `#ffffff` | 输入框 |
| `--btn-bg` / `--btn-hover` | `#ececec` / `#e3e3e3` | 次级按钮 |

**强调与特效**

| 令牌 | 值 | 用途 |
|---|---|---|
| `--hero-grad-a` / `--hero-grad-b` | `#0d0d0d` / `#10a37f` | 首页大标题渐变、CTA 横幅 |
| `--glow-ring` | `rgba(0,0,0,0.12)` | 悬浮/聚焦边框色 |
| `--glow-soft` | `rgba(0,0,0,0.05)` | 聚焦外圈光晕 |
| `--glow-shadow` | `0 2px 8px rgba(0,0,0,0.08)` | 悬浮阴影 |
| `--card-shadow` | `0 4px 16px rgba(0,0,0,0.06)` | 主容器/浮层阴影 |
| `--status-bg` | `rgba(255,255,255,0.95)` | 保存状态胶囊底 |

**语义状态色（散落硬编码，未进令牌层）**

| 场景 | 值 | 位置 |
|---|---|---|
| 成功 / 开关「开」 | `#1a7f37` | `.ff-switch`、`.settings-switch`、`.btn-success`、`.ff-badge.ff-on` |
| 警告 / 待审批 | `#9a6700` | `.status-pending` |
| 拒绝 | `var(--error)` | `.status-rejected` |
| 保存状态 | `#4CAF50` / `#ff9800` / `#f44336` | `.save-status`（成功/保存中/失败） |
| 热力图 4 级 | `#bfe6d9` `#7fd0b8` `#2fae8b` `#0e8a6d` | `.hm-l1`–`.hm-l4`（GitHub 风格） |
| 提示卡（Alerts） | note `#0969da` / tip `#1a7f37` / important `#8250df` / warning `#9a6700` / caution `#cf222e` | `partials/_markdown_alerts_css.html` |
| 代码高亮 | Pygments `default`（亮）+ `monokai`（暗，`[data-theme="dark"]` 选择器）；highlight.js `github` / `github-dark` | `app/core/utils.py:412,506` |

> **注意**：暗色仅存在于**代码高亮**层（`data-theme="dark"` 观察器），站点主体没有任何代码会写入该属性，等同于暗色主题预留但未启用。

### 2.2 字体

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;   /* 系统字体栈，零下载 */
code/pre:   Consolas, Monaco, "Courier New", monospace;
```

| 层级 | 规格 |
|---|---|
| 正文/输入 | 16px（≤640px 仍强制 16px，避免 iOS 聚焦自动缩放，`_responsive_css.html:82`） |
| 导航/列表 | 14px |
| 辅助/时间戳 | 12–13px |
| `h1` | 600 字重 + 底部 1px 分隔线（卡片标题常 `border:none` 去线） |
| 首页 Hero | 34px / 700，渐变裁切文字；≤640px 降至 25–26px |
| 面板头 `.pane-header` | 12px、`uppercase`、`letter-spacing:0.5px` |
| 侧栏分组标题 | 11px、`uppercase`、`letter-spacing:0.05em` |

### 2.3 圆角 / 阴影 / 间距

| 层级 | 圆角 |
|---|---|
| 输入框、按钮、`.btn*` | `10px` |
| 卡片（stat/card/row/post/settings…） | `12px`（`_card_theme_css.html:17-22` 统一收口） |
| 主内容容器 `.container` | `16px`（≤640px 降为 `10–12px`） |
| 胶囊（导航链接、tag-chip、badge、lp-btn） | `999px` |
| 代码块、编辑器面板 | `8px` |
| 缩略图/附件图标 | `10px` |

阴影两档：卡片 `--card-shadow`、悬浮 `--glow-shadow`；浮层（popover/org-menu）用 `0 8px 24px rgba(0,0,0,.18)`。

间距以 4/8px 网格为主：卡片内边距 `13–22px`，容器 `28px 32px 34px`，组件纵向间隔 `8–16px`，版块间隔 `28–48px`。

---

## 3. 布局架构

### 3.1 三套骨架

```
base.html（绝大多数页面）
├─ 匿名态  → partials/_navbar.html   顶部吸顶导航（.navbar sticky）
└─ 登录态  → partials/_sidebar.html  左侧固定侧栏（--sidebar-width: 232px）
            body.has-sidebar { padding-left: calc(232px + safe-area-inset-left) }
   └─ .container  max-width 920px 居中卡片（圆角 16px + 边框 + 阴影）

note_edit.html（独立文档，不 extends base）
└─ fixed 顶栏 + .editor-shell 全视口双栏（editor-pane | splitter | preview-pane）
   + 右下角悬浮按钮列

认证页（login/register，extends base 但 body_class=auth-page）
└─ .auth-split 全幅 grid 5fr / 7fr：左通高插画 + 右居中表单（max-width 420px）
   隐藏顶栏与卡片外壳
```

**样式加载顺序**（决定了层叠优先级，改样式必须遵守）：

1. `theme_vars` + 页面基础规则（base.html 内联）
2. `partials/_navbar_css.html` / `_sidebar_css.html` / `_page_transition_css.html`
3. 页面自身 `<style>`（各模板内联）
4. `partials/_card_theme_css.html`（**最后覆盖**：统一圆角 + 悬浮改发光）
5. `partials/_responsive_css.html`（**兜底**：按钮体系、小屏覆盖）

### 3.2 关键布局参数

| 元素 | 规格 | 出处 |
|---|---|---|
| 侧栏 | `232px` 固定，`flex column`，底部 `margin-top:auto` 放头像/语言 | `_sidebar_css.html` |
| 主容器 | `max-width: 920px; margin: 28px auto 48px; padding: 28px 32px 34px` | `_card_theme_css.html:5` |
| 顶栏 | `padding: 9px 24px`，`overflow:hidden`（触发 JS 折叠测量） | `_navbar_css.html:2` |
| 编辑器 | `position:fixed` 全屏，`padding-top: calc(var(--nav-h) + 8px)`，栏宽可拖拽 | `note_edit.html:27,177` |
| 分隔条 | `flex: 0 0 12px`，把手 3×44px，hover 变 68px 品牌绿 | `note_edit.html:182` |
| 认证分栏 | `minmax(0,5fr) minmax(0,7fr)`，`min-height:100vh` | `_auth_split_css.html:7` |
| 首页双栏 | `.home-recent-row` 两列 `gap:24px` | `base.html:84` |
| 卡片网格 | `repeat(auto-fill, minmax(min(250px,100%),1fr))` | `base.html:102` |

### 3.3 简洁模式（`html.simple-mode`）

账号级偏好（`g.simple_mode`），服务端加类、CSS 隐藏，`base.html:182-188` 与 `note_edit.html:160-171`：

- 隐藏：标签云、笔记标签、置顶、犇犇、编辑器标签栏/预览栏/附件/评论按钮/品牌名/时间戳
- 顶栏收紧 `padding: 7px 24px`，保留登录快捷按钮
- 首页 302 直接跳转新建笔记

---

## 4. 组件体系

### 4.1 按钮（`_responsive_css.html:4-28`）

| 类 | 规格 |
|---|---|
| `.btn` | `background: var(--btn-bg)`，`padding: 9px 18px`，`radius 10px`，`14px/500` |
| `.btn-primary` | 品牌绿底白字，hover `brightness(1.08)` |
| `.btn-secondary` | `--card-bg` 底 |
| `.btn-danger` | 透明底红边 → hover 红底白字 |
| `.btn-success` | `#1a7f37` 底白字 |
| `.btn-sm` | `5px 12px`，`13px`，`radius 8px` |
| `.btn-link` | 无边框文字链，hover 下划线 |
| `.lp-btn` | 落地页专用**胶囊** CTA（`radius 999px`，`11px 24px`），primary/ghost 两态 |

全局 `input, button` 默认 `width:100%`（表单纵向流），`.btn*/td button` 覆盖回 `auto`。

### 4.2 开关（三套同构实现）

| 类 | 尺寸 | 位置 | 选中色 |
|---|---|---|---|
| `.ff-switch` | 46×26，滑块 20px | `/admin/features` | `#1a7f37` |
| `.settings-switch` | 46×26，滑块 20px | 用户设置 | `#1a7f37` |
| `.switch` | 36×20，滑块 16px | 编辑器「实时预览」 | `var(--link)` |

结构统一：`<input type=checkbox opacity:0 absolute>` + `.track` + `::before` 滑块 + `transform: translateX()`；均带 `focus-visible` outline。

### 4.3 徽章 / 标签

- `.ff-badge`：胶囊描边，`ff-on` 绿 / `ff-off` 灰
- `.role-badge`（`.role-owner` 品牌绿描边）、`.status-badge`（pending 琥珀 / approved 绿 / rejected 红）
- `.tag-chip`：胶囊，`active` 为品牌绿实底白字，带 `.tag-count` 计数
- `.tag-chip-all`：**虚线边框**区分「全部」
- `.home-recent-badge`、`.tree-count`、`.ff-group-stat`（分组启用数 `n/m`）

### 4.4 卡片

| 类 | 结构 |
|---|---|
| `.home-card` | flex：`46px 图标方块 + 标题/描述 + 右箭头`，hover 图标与箭头变品牌绿 |
| `.stat-card` | `h3 标题 + .number 28px + .detail`，`stat-grid` 自适应网格 |
| `.ff-card` / `.ff-row` | 图标 + 名称 + 状态徽章/开关 |
| `.settings-section` | 表单分区卡，`h2` 带底线，`.settings-danger` 标题红色 |
| `.wb-panel` | 工作台面板：`head（标题 + 右侧链接）+ 内容列表` |
| `.image-card` / `.attachment-card` | 纵向：缩略图（140px 居中 contain）+ 等宽文件名 + 元信息 + 删除按钮 |
| `.benben-post` / `.comment-post` | 头部（头像+用户名+时间+回复）+ 正文（`max-height` 内滚动） |
| `.lp-step` / `.lp-faq` | 序号圆片 + 标题 + 说明；FAQ 用原生 `<details>` 折叠 |
| `.home-notice` | 公告条：`图标 + 文本`，`--card-icon-bg` 底 + `--glow-ring` 边框，`role="status"` |

### 4.5 表格

- `.share-table`：**卡片化**——`border-collapse: separate` + `border-radius:12px` + `overflow:hidden`，单元格只留右/下边线
- `.members-table` / `.invites-table` / `.requests-table` / `.notes-table` / `.orgs-table`：常规细线表，`th` 13px 灰字
- ≤768px 全部转 `display:block; overflow-x:auto`（`_responsive_css.html:62`）

### 4.6 列表与树

- `.note-list li`：卡片化（`radius 12px` + `margin-bottom 8px`），`.pinned-row` 用 `--card-icon-bg` 底 + `--glow-ring` 边高亮
- 行内动作：`.pin-btn` / `.note-del-btn` 26×26（≤640px 升到 32×32），hover 分别变品牌绿/红
- **文件夹树**：`.folder-tree > .tree-node > .tree-row + .tree-children`，子级 `border-left` 缩进 18px，caret 旋转 90°，折叠状态存 `localStorage('rusin-folder-tree-closed')`，深链进入时自动展开祖先
- **面包屑** `.folder-breadcrumb`：`全部 / a / a / 当前`

### 4.7 工具条 / 表单

- `.list-toolbar` + `.tool-btn`：列表页顶部操作条（新建/图床/附件/导出/导入），`.tool-form` 内嵌虚线边框 file input
- `.form-group`：`label(500) + input`，间距 `margin-bottom:16px`
- `.captcha-row`：输入框 + SVG 验证码 + 40×46 刷新按钮同行
- `.login-sep`：`— 或 —` 分隔线（`::before/::after` flex 线）

### 4.8 浮层 / 抽屉 / 悬浮按钮

| 组件 | 行为 |
|---|---|
| `.org-menu` | `position:fixed`（规避 navbar `overflow:hidden`），JS 按触发器 `getBoundingClientRect` 定位，`opacity + translateY(-6px) scale(.98)` 入场 160ms，点外/ESC 关闭，关闭延迟 160ms 过渡 |
| `.outline-popover` | 编辑器预览栏「大纲」下拉，`abs top:100%`，条目按层级缩进 20→68px |
| `.ref-popover` | `#` 快捷引用自动补全：头部 scope + 滚动列表（`max-height:236px`）+ `active` 高亮 |
| `.outline-panel`（只读页） | ≥1400px 常驻右侧 230px 卡片；窄屏转 `min(320px,85vw)` 右侧抽屉 + `rgba(0,0,0,.35)` 背板，`translateX(100%)` 滑入 |
| `.outline-fab` | 44×44 圆形悬浮按钮（右下），配 `aria-expanded` |
| 编辑器按钮列 | 右下固定纵列：`save-btn`（胶囊）→ `attachment-btn` → `note-delete-btn`（38px 圆），`backdrop-filter: blur(4px)` |
| `.save-hint` | 底部居中深色胶囊 toast（含 `<kbd>` 键位提示），`opacity` 渐显 |
| `.save-status` | 右下状态胶囊，三态配色（成功绿/保存中橙/失败红） |

---

## 5. 交互模式

### 5.1 悬浮 = 边缘发光（核心约定）

`_card_theme_css.html:50-74` 用一张**共享选择器清单**统一声明：

```css
transition: box-shadow .22s ease, border-color .2s ease, background .2s ease, color .2s ease;
/* hover：只发光，不位移不缩放 */
box-shadow: var(--glow-shadow) !important;
border-color: var(--glow-ring) !important;
```

清单覆盖：home-card、stat-card、ff-card/row、image/attachment-card、benben/comment-post、settings-section、note-list li、tag-chip、tree-toggle、导航链接、save-btn、outline 项、pin-btn 等 40+ 组件。

### 5.2 聚焦可见性

```css
input:focus { border-color: var(--glow-ring); box-shadow: 0 0 0 3px var(--glow-soft); }
.editor-shell textarea:focus, .tag-bar input:focus { box-shadow: none; }  /* 无边框输入不加光晕 */
*:focus-visible { outline: 2px solid var(--glow-ring); outline-offset: 2px; }
```

### 5.3 导航激活态

`partials/_nav_attrs.html` 宏按 `request.path` 前缀匹配输出 `class="... active"` + `aria-current="page"`（可 `exclude` 子页）。

- 横向链接：`::after` 2px 下划线 `scaleX(0)→scaleX(1)`，`.24s cubic-bezier(.4,0,.2,1)`，**仅选中项常驻**，hover 不再出现下划线
- 折叠/侧栏窄屏：改为 `box-shadow: inset 3px 0 0 var(--link)` 左侧竖条

### 5.4 页面切换动画（`_page_transition_css.html`）

- 支持的浏览器：`@view-transition { navigation: auto }` 跨文档交叉淡入 `0.26s`
- 回退：`@supports not (view-transition-name:none)` 时 `.container/.editor-shell` 执行 `rusin-page-in`（`opacity 0→1 + translateY(8px)`，`0.28s`）
- `prefers-reduced-motion: reduce` 时两者均 `animation: none`

### 5.5 导航栏 JS 折叠（`base.html:204-257`）

`updateMenuState()` 在 `load/resize` 时给 navbar 加 `measuring` 类，把 `.nav-links`/`.user-info` 临时 `position:absolute + visibility:hidden` 量 `scrollWidth`，与 brand/menu/lang 宽度求和；超出 `clientWidth` 则加 `menu-collapsed`（纵向下拉列表 + 汉堡按钮）。`toggleMenu()` 切换 `menu-open` 并替换 `fa-bars ↔ fa-xmark` 图标。

### 5.6 其它微交互

- 编辑器分隔条：拖拽改栏宽（`touch-action:none`），hover/focus/dragging 时把手变绿加长
- 实时预览开关：切换 `.show-preview` / `.preview-hidden` 类
- 目录/大纲：滚动 `requestAnimationFrame` 节流高亮当前章节，`localStorage('rusin-outline-collapsed')` 记忆
- 删除确认：统一 `data-confirm` + `window.confirm`（笔记、图片、附件、评论）
- 评论/犇犇：输入 300ms 防抖后 `marked` + **DOMPurify 白名单**清洗再渲染预览（与服务端 bleach 同标签集）

---

## 6. 响应式策略

| 断点 | 变化 |
|---|---|
| **≥1400px** | 只读页大纲常驻右侧面板（`matchMedia('(min-width:1400px)')`） |
| **≤768px** | 侧栏 `232px → 56px` 纯图标竖栏（隐藏 `.side-text`，激活态改左内嵌条）；编辑器默认隐藏预览栏（按钮切换）；认证页隐藏插画回退单列；数据表格整表横向滚动；`.home-recent-row` 单列 |
| **≤640px** | 容器 `margin:10-16px`、`radius 10-12px`、`padding 16px 12px`；`h1 23px / h2 18px`；Hero 26px；面板内边距收窄；输入保持 16px；pin/删除按钮 26→32px；热力图格 12→10px；编辑器按钮列整体收紧 |
| **≤480px** | 隐藏居中 `.note-mtime`（避免与右侧按钮列重叠）；`.save-hint` 允许换行 |

其它适配细节：

- **刘海屏**：`env(safe-area-inset-left)` 用于侧栏 `padding-left` 与 `body` 偏移
- **触控**：`.tool-btn` 等在 ≤640px `flex:1` 拉宽居中
- **图片**：`img { max-width:100%; height:auto }`；Markdown 宽表格 `display:block; overflow-x:auto`
- **reduced-motion**：navbar / sidebar / page-transition 三处 partial 均有 `@media (prefers-reduced-motion: reduce)` 关闭过渡

---

## 7. 页面清单与布局形态

| 页面 | 模板 | 布局要点 |
|---|---|---|
| 匿名首页 | `home.html` else 分支 | `.home-hero` 渐变站名 + 标语 → 功能开关过滤的 `.home-grid` 卡片 → GitHub 卡 → 全宽犇犇卡 |
| 登录态首页 | `home.html` if 分支 | **类 ChatGPT 落地页**：`lp-hero`（56px 头像 + 问候 + 渐变 Tagline + 双 CTA + 3 数据）→ 功能卡片区 → 使用指南 3 步 → 记录轨迹（GitHub 风格热力图 + 最近编辑）→ FAQ 折叠 → 渐变 CTA 横幅 `.lp-band` |
| 公告 | `home.html` / `user_list.html` | `.home-notice` 横幅（`NOTICE.txt` 首行，空则不渲染） |
| 登录 / 注册 | `auth/login.html` `auth/register.html` | `auth-split` 左插画右表单，46px 控件，主按钮品牌绿；下方「或」+ OAuth 网格 + 条款小字 |
| 2FA 挑战 / 管理 | `twofa/*.html` | base + settings-section 风格 |
| 验证码登录 / 联系方式 | `email/*.html` | base 表单流 |
| OAuth 绑定管理 | `oauth/manage.html` | 绑定卡片列表 |
| 笔记列表 | `notes/user_list.html` | `h1(32px 头像)` + `.list-toolbar` + 面包屑 + 标签云 + 文件夹树/卡片列表 |
| 笔记编辑器 | `notes/note_edit.html` | **独立布局**：fixed 顶栏 + 双栏 + 可拖分隔条 + 标签栏 + 右下按钮列 + 引用补全/大纲浮层 |
| 笔记只读 | `notes/note_md.html` | base + `.markdown-body` + 大纲面板/FAB |
| 分享管理 | `share/share_list.html` | 创建表单 + 卡片化 `.share-table` |
| 犇犇 | `benben/benben.html` | 发布表单 + 实时预览 + 帖子列表（`max-height` 限高滚动）+ 分页 |
| 评论 | `comments/comments.html` | 独立页，同犇犇结构 + 计数 |
| 图床 / 附件 | `images/` `attachments/` | `.image-grid` 卡片（缩略图 + 等宽文件名 + 元信息 + 删除）+ 用量提示 |
| 用户设置 | `notes/user_settings.html` | `settings-section` 分区：外观开关 / 账号安全入口（2FA·联系方式·第三方）/ 改密码 / 改用户名（红色危险区） |
| 组织系列 | `org/*.html` | `.org-header` + `.btn` 动作组 + 角色/状态徽章表格 |
| 统计 | `count.html` | `.stat-grid` 数据卡 + 按组折叠的「功能状态」`.ff-grid` |
| 功能开关管理 | `admin/features.html` | `ff-group <details>`（默认收起，标题旁 `n/m`）+ `.ff-row` 开关行 |
| 免责声明 | `disclaimer.html` | `.disclaimer` 卡片 |
| 错误页 | `errors/{400,401,404,429,500}.html` | 见 §10 已知问题（风格游离） |

---

## 8. 图标与外部资源

| 资源 | 用法 |
|---|---|
| **Font Awesome 6.5.2** | 唯一图标库，`<link media="print" onload="this.media='all'">` 异步加载 + `noscript` 回退；`woff2` `rel=preload` |
| **CDN** | 统一走 `config.GLOBAL_CDN`（默认 `https://cdn.jsdmirror.cn`）拼 `npm/` 路径 |
| 客户端库 | `marked@12.0.2`、`dompurify@3.1.7`、`highlight.js`（github/github-dark 双主题）、KaTeX、FontAwesome |
| 头像 | 外链模板（默认 cravatar，`{hash}=md5(用户名)`），尺寸 20/24/28/32/44/56px，`loading="lazy"` + `referrerpolicy="no-referrer"` |
| 登录插画 | `/image/login-hero.webp`（`object-fit:cover` 通高铺满左栏） |
| favicon | `/favicon.ico` 内存缓存（`theme.get_favicon`） |

---

## 9. 无障碍与国际化

**无障碍**

- `lang` 属性跟随语言；图标按钮均有 `title` + `aria-label`，装饰性 `<i>` 带 `aria-hidden="true"`
- `aria-current="page"`（导航激活）、`aria-expanded/haspopup/controls`（下拉与折叠）、`aria-pressed`（置顶开关）、`aria-orientation`（分隔条 `role="separator"` + `tabindex`）
- 公告/导入提示用 `role="status"`
- `focus-visible` 双层保障（outline + glow）；开关用真实 checkbox 保证键盘可达
- 三处 `prefers-reduced-motion` 降级；`noscript` 提供验证码刷新与 FontAwesome 回退
- 长内容限高滚动：犇犇/评论 `max-height`（默认 280px）+ `overscroll-behavior: contain`

**国际化**

- `{{ t('key') }}` 中英双字典（`app/core/i18n.py`），缺 key 回退 key 本身便于发现遗漏
- 语言切换：顶栏 `.lang-toggle`（地球图标 + `En/中`）、认证页右上角同款；`/lang/<lang>` 回跳 Referer
- 语言检测：Cookie `rusin-lang` > `Accept-Language` > zh

---

## 10. 已知问题与改进建议

| # | 问题 | 位置 | 建议 |
|---|---|---|---|
| 1 | **错误页风格游离**：热链 `vjudge.net` 外站 GIF/JPG，使用已废弃的 `<center>` 标签、内联 `style="color: rgb(204,85,16)"`，标题未走 i18n；外链失效/被墙则页面空白，且存在第三方可用性与隐私风险 | `templates/errors/*.html` | 重做为与 `.disclaimer`/`.stat-card` 一致的站内卡片，图标用 FontAwesome，文案接入 `t()` |
| 2 | **暗色主题半成品**：`utils.py` 已生成 Pygments `monokai` 暗色规则与 hljs `github-dark`，并挂了 `data-theme` MutationObserver，但全站无任何代码写入该属性，`i18n.get_theme_labels_js` / `theme_script` 成为死代码；SKILL.md 仍描述「暗色主题切换」 | `utils.py:428,536`、`i18n.py:1270` | 要么补齐暗色 `THEME_VARS` + 切换入口，要么删除预留避免误导 |
| 3 | **语义色未令牌化**：`#1a7f37`、`#9a6700`、`#4CAF50` 等硬编码散布 20+ 处，改主题需全局搜索 | 各模板 | 抽 `--success/--warn/--danger-soft` 等令牌 |
| 4 | **组件重复定义**：`.btn-sm`、`.share-table`、`.benben-post` 圆角等在多个模板重复声明（`_card_theme_css` 再统一覆盖一次），层叠依赖顺序脆弱 | `share_list`/`image_list`/`benben` 等 | 抽出 `_components_css.html` partial 统一维护 |
| 5 | **触控目标偏小**：`.pin-btn`/`.note-del-btn` 26×26（≤640 才升到 32），低于 44×44 建议值 | `user_list.html:45,51` | 移动端直接 44px 或加透明热区 |
| 6 | **卡片圆角不一致**：benben/comment post 8px、image-card 10px、其余 12px——部分被 `_card_theme_css` 收口，部分漏网 | — | 统一到 12px（或在令牌层定义 `--radius-card`） |
| 7 | **模板内联 `<style>`/`<script>` 巨量**：`note_edit.html` 单文件 62KB，前端仅靠 `frontend_check.py` 做语法配平，无压缩/缓存 | `note_edit.html` | 长期可考虑引入极简构建（或至少把公共 JS 抽为可缓存片段） |
| 8 | **仅浅色**：无 `prefers-color-scheme` 响应，暗环境刺眼 | `theme.py` | 配合 #2 一并决策 |

---

## 11. 开发约定（改动 UI 前必读）

1. **改完跑** `python tests/frontend_check.py`（Jinja2 解析 + 内联 CSS 括号配平 + JSON；有 Node 时校验内联 JS）
2. **样式加载顺序**不可颠倒：页面样式 → `_card_theme_css`（覆盖圆角/悬浮）→ `_responsive_css`（兜底）
3. **悬浮效果**只用发光（`--glow-shadow` + `--glow-ring`），不要加 `transform: translateY/scale`
4. 新增颜色优先加进 `THEME_VARS` 令牌，不要直接写 hex
5. 新增文案必须 zh/en **成对**加进 `i18n.STRINGS`，模板用 `{{ t('key') }}`
6. 新增图标按钮必须带 `aria-label` + `aria-hidden` 图标
7. 新增可开关功能的入口要用 `feature_enabled(key)` 条件渲染
8. 遵守简洁模式：新功能组件若属「高级功能」，补一条 `.simple-mode .xxx { display:none }`
9. 断点以 **768 / 640 / 480** 为准，注意 16px 输入字号（iOS 缩放）与 `safe-area-inset`
