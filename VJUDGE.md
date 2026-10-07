# VJudge 接口参考（VJUDGE.md）

> 目的：为 OI-Code 集成 Virtual Judge（<https://vjudge.net>）的**题面获取 / 题面翻译 / 在线提交 / 判题记录爬取**能力提供接口级参考。
>
> **重要前提：VJudge 没有官方公开 API 文档。** 本文内容来自两类取证：
>
> - **实测**：直接对公开端点发请求并记录真实响应（本文标注 `[实测]`）。
> - **前端逆向**：从其静态 JS 包（`https://vjudge.net/static/bundle/<hash>.js`，共 12 个入口块 + 33 个异步块）中提取的调用代码（标注 `[bundle]`）。
>
> 未标注或标注 `[待验证]` 的条目需在登录态下复核后才能依赖。接口随时可能变动，**集成必须做好失败降级**。

---

## 1. VJudge 是什么，怎么用它

VJudge 不是传统 OJ：**它把 50+ 个远端 OJ 的题目抓取到本地库，再把用户的代码"模拟提交"到远端 OJ，并回爬判题结果**。因此：

| 能力 | VJudge 侧行为 | 对集成的影响 |
|------|----------------|--------------|
| 题面 | 抓取远端题面存库，页面渲染本地副本 | 首次访问某题可能要先"抓取"（crawl task） |
| 提交 | 转发到远端 OJ（用 VJudge 的服务账号或用户绑定的账号） | 提交是**真实打到远端 OJ** 的，会计入远端榜单 |
| 判题结果 | 异步回爬，先返回 `Submitted` | 必须轮询状态，不能同步等结果 |
| 翻译 | 提供 "请求 AI 翻译"（`translation_tip`） | 也是异步任务，需轮询 |

支持的部分 OJ（首页可查，节选）：POJ、ZOJ、URAL、SPOJ、HDU、HYSBZ、UVA、CodeForces、AtCoder、LibreOJ、UniversalOJ、洛谷、Baekjoon、CSES、USACO、Yosupo、DMOJ、EOlymp、Kattis、CodeChef、计蒜客、牛客、NBUT、FZU、CSU、SCU、UESTC、HihoCoder、HackerRank、51Nod、TopCoder、QOJ、VNOJ、TLX、yukicoder、oj.uz、ACMP、BZOJ、黑暗爆炸 …

**题目主键格式**：`{OJ}-{probNum}`，例如 `CodeForces-1748E`、`POJ-1000`、`Luogu-P1001`。URL 中需 `encodeURIComponent`。

---

## 2. 通用约定

| 项 | 值 / 说明 |
|----|-----------|
| Base URL | `https://vjudge.net`；前端用全局 `basePath`（通常为**空串**）拼路径 |
| 认证 | **Session Cookie**（登录后由服务端下发），无 Bearer / API Key 机制 `[bundle]` |
| CSRF | 写操作需带页面注入的 `token` 字段（如登录、提交）`[bundle]` |
| 列表接口 | 走 **DataTables** 协议：请求 `draw,start,length,...`，响应 `{draw, recordsTotal, recordsFiltered, data}` `[实测]` |
| 写操作体 | 提交类为 **form-urlencoded**（jQuery 默认）；抓取任务为 **JSON**（`contentType: "application/json"`）`[bundle]` |
| 未登录（API） | `401` + `{"error":{"i18nKey":"user.error.login_required","trustable":false}}` `[实测]` |
| 未登录（页面） | `303` 重定向到 `https://vjudge.net/?login=1&continue=<原路径>` `[实测]` |
| 人机验证 | Cloudflare Turnstile（登录表单含 `turnstile-container`，失败文案 `user.error.human_verification_failed`）`[bundle]` |
| 静态资源 | Cloudflare 托管；高频请求易触发挑战页 |

**错误信封**（所有 JSON 接口统一）：

```json
{ "error": { "i18nKey": "user.error.login_required", "trustable": false } }
```

集成时按 `error.i18nKey` 分支处理，不要匹配中文文案。

---

## 3. 认证相关接口

| 方法 | 路径 | 参数 | 来源 |
|------|------|------|------|
| POST | `/user/login` | form：`username`（用户名或 Email）、`password`、`token` | `[bundle]` |
| GET | `/user/checkLogInStatus` | — | `[bundle]` |
| POST | `/user/logout` | — | `[bundle]` |
| POST | `/user/register` | 用户名 / 邮箱 / 验证码等 | `[bundle]` |
| GET | `/user/sendRegisterCode` | — | `[bundle]` |
| POST | `/user/update` | 资料与远端账号设置 | `[bundle]` |
| GET | `/user/remoteAccounts?oj={OJ}` | 该 OJ 下我已绑定的账号（页面，303→登录）| `[实测]` |
| GET | `/user/remoteAccounts/list` | 远端账号列表（JSON） | `[bundle]` |
| GET | `/user/solveDetail2/{username}` | 用户刷题统计 | `[bundle]` |

前端登录调用（原样摘自 bundle）：

```js
const data = { username: ..., password: ..., token: e.token };
$.ajax({ url: basePath + "/user/login", type: "POST", data });
```

> **集成结论**：`token` 与 Turnstile 都依赖浏览器环境，**纯 HTTP 客户端模拟登录不可靠**。推荐做法：用 OI-Code 已有的内置浏览器（`webview`，已支持 Cookie 持久化）让用户**手动登录一次**，之后所有 API 请求复用该 webview 会话（或由主进程读取该分区的 Cookie 发请求）。

---

## 4. 题面 API

### 4.1 题目元信息 `[实测]`（**无需登录**）

```
GET /problem/info/{OJ}-{probNum}
```

实测样例：

```bash
curl https://vjudge.net/problem/info/CodeForces-1748E
```

```json
{"pid":4074942,"crawling":false,"title":"Yet Another Array Counting Problem","error":""}
```

| 字段 | 含义 |
|------|------|
| `pid` | VJudge 内部数字题号（其他接口可能用它） |
| `title` | 题目标题 |
| `crawling` | 是否正在抓取题面（true 时题面尚不可用） |
| `error` | 抓取/题目不可用原因，正常为空串 |

### 4.2 题面正文 `[待验证]`

- 页面 `GET /problem/{OJ}-{probNum}` 需登录（实测 `303` 跳转），题面正文由该页面渲染，**未发现独立的"取题面 HTML"公开 JSON 端点**。
- 可选实现路径（按优先级）：
  1. **webview 内取 DOM**：在内置浏览器打开题目页，直接取渲染后的题面容器（含 MathJax/KaTeX 结果），最稳。
  2. **登录后抓 HTML**：主进程带 Cookie `GET /problem/{OJ}-{probNum}`，解析题面节点。
  3. 若发现 `pid` 维度的题面端点，补录到本节。

### 4.3 题面抓取任务（题面缺失 / 重新抓取）`[bundle]`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/problem/crawl/tasks` | DataTables 列表；参数 `draw,start,length,scope(all\|mine),status` |
| POST | `/problem/crawl/tasks` | **创建抓取任务**，JSON 体见下 |
| GET/POST | `/problem/crawl/tasks/dataById` | 按任务 id 轮询状态 |

创建抓取任务（bundle 原样）：

```js
$.ajax({
  url: `${basePath}/problem/crawl/tasks`,
  type: "POST",
  contentType: "application/json",
  data: JSON.stringify({
    remoteOj: "CodeForces",        // 远端 OJ 名
    remoteProblemId: "1748E",      // 远端题号
    accountMode: "AUTO",           // "AUTO" | "BINDING"（用绑定账号抓取）
    bindingId: null                // accountMode === "BINDING" 时为账号 id
  })
});
```

任务列表行含 `triggerSource`、`crawl` 相关状态字段；UI 文案键：`problem.crawl.tasks.*`。另有"重新抓取"按钮 `recrawl`。

### 4.4 题目搜索建议 `[实测]`（需登录）

```
GET /problem/suggestions?q={关键词}
→ 401 {"error":{"i18nKey":"user.error.login_required","trustable":false}}
```

---

## 5. 题面翻译 API

bundle 中与翻译相关的仅有 i18n 键（多语言文案齐全，说明是正式功能）：

| 键 | 中文文案 |
|----|----------|
| `translation` | 翻译 |
| `translation_tip` | **请求 AI 翻译** |
| `statements` | 问题文（题面多语言列表） |

推断与待验证清单：

1. 翻译**大概率复用抓取任务通道**（`/problem/crawl/tasks` 的 JSON 体可能还有 `type` / `targetLanguage` 之类字段），也可能是独立的 `/problem/translation*` 端点。
2. 需要登录态点击"翻译"按钮，抓取一次真实的请求 URL + 请求体 + 响应，再回填本节。
3. 已试过的猜测路径 `/problem/detail/{OJ}-{id}`、`/problem/translation/{OJ}-{id}` 均返回 **404**（说明不是这两个名字）`[实测]`。

> 在文档补全前，OI-Code 侧不要硬编码翻译端点；可先用「本地 LLM/离线词典」或让用户在 webview 里点 VJudge 自带翻译。

---

## 6. 提交 API

### 6.1 提交代码 `[bundle]`

```
POST {basePath}/problem/submit/{OJ}-{probNum}
Content-Type: application/x-www-form-urlencoded
```

请求字段（bundle 原样还原）：

| 字段 | 取值 / 含义 |
|------|-------------|
| `source` | 源码正文 |
| `language` | 语言 id（下拉框 `[name=language]` 的值，如 `GNU G++23 14.2 (64 bit, msys2)` 对应的数字 id） |
| `method` | 提交方式：`0` = VJudge 服务账号；`1` / `2` = 使用**用户绑定的远端账号**（此时可带 `bindingId`） |
| `bindingId` | 远端账号绑定 id（`method` 为 1/2 且用户选了账号时） |
| `open` | 提交记录可见性（`[name=open]:checked`） |
| `token` | 页面注入的 CSRF token |

成功响应含 **`runId`**（VJudge 侧提交号）；失败时前端会引导去 `/user/remoteAccounts?oj={OJ}` 绑定账号。

比赛内提交（另一条路径）：

```
POST {basePath}/contest/submit/{contestId}/{num}   // 额外带 accessCode、version
```

修改并重交已有提交：

```
GET {basePath}/solution/edit/{runId}
```

### 6.2 可选语言列表 `[待验证]`

提交弹窗的语言下拉由题目页初始化时取得；需在登录态确认具体端点（候选：题目页内联数据或 `/problem/lang` 类接口）。**不要**在集成里写死语言 id 表——不同远端 OJ 完全不同。

### 6.3 判题记录与结果 `[实测]`

```
GET /status/data?draw=1&start=0&length=N[&其他过滤参数]
```

实测响应（DataTables 信封）：

```json
{
  "draw": 1,
  "recordsTotal": ...,
  "recordsFiltered": ...,
  "data": [
    {
      "runId": 73165988, "problemId": 4019519,
      "oj": "AtCoder", "probNum": "abc205_a",
      "status": "Submitted", "statusType": 2, "processing": true,
      "runtime": 0, "memory": 0, "time": 1791379511000,
      "language": "C++23 (GCC 15.2.0)", "languageCanonical": "CPP",
      "sourceLength": 159, "access": 2,
      "userId": 1336862, "userName": "hagerwael", "avatarUrl": "..."
    }
  ]
}
```

| 字段 | 用途 |
|------|------|
| `runId` | 提交号；轮询与详情都靠它 |
| `status` | 判题结果文本（`Submitted` / `Accepted` / `Wrong Answer` …） |
| `processing` | **true 表示结果未定，必须继续轮询** |
| `statusType` | 结果分类（数值），适合做颜色映射（待补全枚举表） |
| `runtime` / `memory` | 耗时 / 内存（远端返回值，单位随 OJ） |
| `languageCanonical` | 语言规范名（`CPP` 等），比 `language` 稳定 |
| `time` | 提交时间戳（毫秒） |

另有按 id 批量取记录：`GET/POST {basePath}/status/dataById` `[bundle]`。
单条提交在远端的原始记录：`{basePath}/solution/{runId}/origin` `[bundle]`。
重判：`POST {basePath}/problem/rejudge/{OJ}-{probNum}` `[bundle]`。

### 6.4 典型提交—取结果时序

```
1. (可选) GET /problem/info/{OJ}-{id}      → 确认题目存在、crawling=false
2. POST /problem/submit/{OJ}-{id}          → { runId }
3. 轮询 status（/status/data 或 dataById）  → 直到 processing=false
4. 读 status / runtime / memory            → 映射为 OI-Code 的 AC/WA/TLE/MLE/RE/CE
```

---

## 7. 在 OI-Code 中的落地设计（待实现，先对齐架构）

| 关注点 | 方案 | 归属层 |
|--------|------|--------|
| 服务契约 `IVjudgeService`（题面、提交、查状态） | 接口 + `createDecorator`，方法先行 | Platform |
| 实际发请求（Cookie、代理、重试） | Node 侧实现，注册进主进程；**渲染进程不直连网络** | Code（`apps/desktop/src/main`） |
| 登录 | 复用内置浏览器 `webview` 分区 Cookie，不自己存密码 | Workbench（UI）+ Code（Cookie 读取） |
| 题面渲染 | 取回的 HTML 走 Markdown/HTML 预览分屏；公式需补 KaTeX（阶段 5） | Workbench / Editor |
| 提交→判题轮询 | 复用评测机的异步 + 进度通知模式（JSON-RPC 通知） | Platform 协议 + Code |
| 状态映射 | `status`/`statusType` → `JudgeVerdict`（AC/WA/TLE/MLE/RE/CE） | Platform 纯函数 + 单测 |
| 资源生命周期 | 轮询定时器必须进 `DisposableStore`，取消即停 | 全层通用 |

**注意**：工具链与外部 OJ 集成在 Extension Host（阶段 6）落地后应迁到 `libs/extensions/`，当前先放 Code 层。

---

## 8. 风险与合规（必读）

1. **无官方 API**：路径/字段可能随时变更，所有调用要有超时、重试上限与"接口失效"降级提示。
2. **Cloudflare 反爬**：高频请求会触发挑战页；务必限速（建议：题面查询 ≥1 req/s，状态轮询前 5s 每 2s 一次、之后退火到 5–10s）。
3. **真实远端提交**：VJudge 的提交会打到远端 OJ 并计入其记录，**消耗用户/服务账号配额**，不可用于压测或批量刷提交。
4. **账号风险**：脚本化登录/提交可能触发风控甚至封号；优先"人在浏览器里操作、程序只读结果"的模式。
5. **凭据安全**：绝不在代码、配置、日志、Git 历史中写入 VJudge 或远端 OJ 的账号密码；会话 Cookie 只存系统用户数据目录，且不入版本库。
6. **题面版权**：抓取到的题面仅作本地个人学习展示，不要二次分发或缓存进仓库。
7. **礼仪**：集成上线前建议查阅 VJudge 站点说明/联系作者确认自动化使用边界。

---

## 9. 待验证清单（需登录态抓包）

- [ ] 题面正文的取回方式：题目页里承载题面的容器/接口（HTML 结构 + 是否有 JSON 端点）。
- [ ] AI 翻译的真实端点、请求体（是否复用 `crawl/tasks`）与结果轮询方式。
- [ ] 提交弹窗的**语言列表端点**与各 OJ 的语言 id 映射。
- [ ] `method` 三个取值的准确语义、`open` 的取值范围。
- [ ] `statusType` 枚举与判题结果的完整对照表。
- [ ] `/problem/suggestions` 的请求参数与响应结构。
- [ ] 提交失败的错误信封样例（远端 OJ 不可用、账号未绑定、题面未抓取）。
- [ ] `/status/data` 的过滤参数（按 `problemId` / `userName` / `oj` 过滤的字段名）。

复核方法：登录 → 打开题目页 → DevTools Network 面板记录上述操作的实际请求，把 URL / 请求体 / 响应样例回填本文对应小节，并把 `[待验证]` 改为 `[实测]`。

---

## 10. 取证方法附录（可复现）

```bash
# 1) 取入口脚本列表
curl -s https://vjudge.net/ | grep -o 'src="/static/bundle/[^"]*\.js"'

# 2) 异步块文件名来自 webpack 运行时的 n.u 映射（文件名为 <hash>.js，不含 chunk id）
grep -ohrE 'n\.u=e=>\(\{[^}]+\}' *.js | grep -oE '[0-9a-f]{20}' | sort -u \
  | sed 's|^|https://vjudge.net/static/bundle/|; s|$|.js|'

# 3) 挖端点与调用上下文
grep -ohrE '[`"][^`"]{0,30}(problem|solution|status|user|contest)[^`"]{0,50}[`"]' .
grep -ohrE '.{300}problem/submit/.{300}' .

# 4) 实测公开端点
curl -i https://vjudge.net/problem/info/CodeForces-1748E
curl -i "https://vjudge.net/status/data?draw=1&start=0&length=1"
curl -i https://vjudge.net/problem/suggestions?q=1748E        # 401 login_required
curl -i https://vjudge.net/problem/CodeForces-1748E           # 303 → /?login=1&continue=...
```

> 本文档不含任何账号凭据。测试账号与会话信息一律不得写入仓库。
