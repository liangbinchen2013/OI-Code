# VJudge 接口参考（VJUDGE.md）

> 目的：为 OI-Code 集成 Virtual Judge（<https://vjudge.net>）的**题面获取 / 题面翻译 / 在线提交 / 判题记录爬取**能力提供接口级参考。
>
> **重要前提：VJudge 没有官方公开 API 文档。** 本文内容来自三类取证：
>
> - **实测**：直接对公开端点发请求并记录真实响应（本文标注 `[实测]`）。
> - **登录态抓包**：浏览器 DevTools 导出的 HAR，含真实提交与判题轮询全过程（标注 `[实测]`，见 §6）。
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
| CSRF | 登录需要页面注入的 `token` 字段 `[bundle]`；**提交接口实测不需要 token**（`[实测]` 见 §6.1） |
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

### 6.1 提交代码 `[实测]`

```
POST {basePath}/problem/submit/{OJ}-{probNum}
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
```

抓包实测（对 `POJ-1182` 的一次真实提交，最终 Accepted）：

```
method=0&language=0&open=1&source=<源码原文，URL 编码>
→ 200 {"runId":73166362}
```

| 字段 | 取值 / 含义 | 可信度 |
|------|-------------|--------|
| `source` | 源码原文（URL 编码后整体作为表单值，含换行与中文注释） | `[实测]` |
| `language` | 语言 id，**按远端 OJ 各自编号**：POJ 的 `0` = `C++98 (MinGW GCC 4.4.0)` | `[实测]` |
| `method` | `0` = 走 VJudge 服务账号；`1` / `2` = 用用户绑定的远端账号（配合 `bindingId`） | `[实测=0]` / `[bundle]` |
| `open` | 提交记录可见性，实测 `1`；响应回显为 `isOpen` | `[实测]` |
| `bindingId` | 仅 `method` 为 1/2 且选择了绑定账号时携带 | `[bundle]` |

> **不需要 CSRF `token`**：bundle 里提交体带有 `token` 字段，但实测请求中并无该字段也能成功——登录 Cookie 是唯一凭据。集成时不要去找页面抠 token。

失败响应带 `errorCode`，前端据此分支 `[bundle]`：

- `errorCode` 以 `bind_account` 开头 → 引导用户去 `{basePath}/user/remoteAccounts?oj={OJ}` 绑定远端账号；
- 其余按 `error.i18nKey` 提示（兜底文案键 `submit.unknown_error`）。

其他提交入口：

```
POST {basePath}/contest/submit/{contestId}/{num}   // 比赛内提交，额外带 accessCode、version
GET  {basePath}/solution/edit/{runId}              // 取回已有提交用于编辑重交
```

### 6.2 轮询单条提交结果 `[实测]`

```
POST {basePath}/solution/data/{runId}
Content-Type: application/x-www-form-urlencoded
body: showCode=false        // true 时响应额外带回源码
```

同一 `runId` 的两次实测响应：

```json
// 判题中（提交后约 0–4s，抓包连续 3 次都是这个状态）
{"runId":73166362,"status":"Submitted","statusCanonical":"PENDING","statusType":2,
 "processing":true,"refreshing":true,"memory":0,"runtime":0,
 "oj":"POJ","probNum":"1182","remoteRunId":"25215486",
 "language":"C++98 (MinGW GCC 4.4.0)","prismClass":"cpp","length":1737,
 "code":true,"isOpen":1,"editable":false,"hasSubmissionOriginViewer":true,
 "author":"<用户名>","authorId":1338149,"submitTime":1791380164000}

// 判题完成
{"runId":73166362,"status":"Accepted","statusCanonical":"AC","statusType":0,
 "processing":false,"refreshing":false,"memory":632,"runtime":50,
 "oj":"POJ","probNum":"1182","remoteRunId":"25215486", ... }
```

| 字段 | 含义 / 用法 |
|------|-------------|
| `statusCanonical` | **机器可读结果码**（实测 `PENDING`、`AC`），集成一律用它，不要用 `status` 文案 |
| `status` | 展示用文本（`Submitted` / `Accepted` …） |
| `statusType` | 结果分类数值；实测 `2` = 待判、`0` = Accepted（完整枚举待补） |
| `processing` / `refreshing` | true 表示结果未定，**必须继续轮询**；两者同时转 false 即为终态 |
| `runtime` / `memory` | 耗时(ms) / 内存(KB)，POJ 实测 `50` / `632` |
| `remoteRunId` | **远端 OJ 的提交号**（用于跳远端查详情） |
| `submitTime` | 提交时间戳（毫秒） |
| `code` | **二义字段**：`showCode=true` 时为源码字符串；否则为布尔（表示"有源码可看"） |
| `length` / `prismClass` | 源码长度 / 高亮语言类名 |
| `isOpen` / `editable` / `hasSubmissionOriginViewer` | 可见性 / 可否编辑 / 是否有远端原始记录入口 |

轮询节奏（抓包观测）：提交后前几次为 `PENDING`，约 4–6s 内转终态；建议 1s 起、指数退火到 5s，并设总超时。

### 6.3 结果映射到 OI-Code 的 `JudgeVerdict`

| `statusCanonical` | OI-Code 判定 | 可信度 |
|-------------------|--------------|--------|
| `PENDING` | 继续轮询（非终态） | `[实测]` |
| `AC` | `AC` | `[实测]` |
| 其余（WA / TLE / MLE / RE / CE / PE 等） | 需抓包补全取值后映射 | `[待验证]` |

映射应实现为 Platform 层纯函数 + 单测（见 §7），未知码一律降级为"未知/需人工查看"，不得静默当作 AC。

### 6.4 提交记录列表（爬取记录）`[实测]`

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
      "userId": 1336862, "userName": "<用户名>", "avatarUrl": "..."
    }
  ]
}
```

| 字段 | 用途 |
|------|------|
| `runId` | 提交号；轮询与详情都靠它 |
| `status` / `statusType` | 结果文本 / 分类 |
| `processing` | **true 表示结果未定，必须继续轮询** |
| `runtime` / `memory` | 耗时 / 内存（单位随远端 OJ） |
| `languageCanonical` | 语言规范名（`CPP` 等），比 `language` 稳定 |
| `time` | 提交时间戳（毫秒） |

按 id 批量取记录：`{basePath}/status/dataById` `[bundle]`。

### 6.5 可选语言列表 `[待验证]`

提交弹窗的语言下拉取自运行时按 OJ 索引的映射（bundle 里形如 `E[oj].languages`），**未在 JS 中找到静态语言表，也没有找到独立端点**；候选来源是题目页服务端渲染的数据。集成时**不要写死语言 id**——各远端 OJ 编号完全不同（POJ `0` = C++98 GCC 4.4.0 即为实测例）。

### 6.6 其他提交相关端点 `[bundle]`

| 路径 | 用途 |
|------|------|
| `POST {basePath}/solution/delete/{runId}` | 删除提交记录 |
| `POST {basePath}/solution/toggleOpen/{runId}` | 切换记录可见性 |
| `GET {basePath}/solution/shareText/{runId}` | 生成分享文本 |
| `GET {basePath}/solution/{runId}/origin` | 远端原始记录入口（配合响应里的 `hasSubmissionOriginViewer`） |
| `GET {basePath}/problem/{OJ}-{probNum}/origin` | 题目在远端 OJ 的原始页 |
| `POST {basePath}/problem/rejudge/{OJ}-{probNum}` | 请求重判 |

### 6.7 典型提交—取结果时序（全链路 `[实测]`）

```
1. (可选) GET  /problem/info/{OJ}-{id}        → 题目存在且 crawling=false
2. POST    /problem/submit/{OJ}-{id}          → { "runId": 73166362 }
3. POST    /solution/data/{runId}  (showCode=false)
      ├─ statusCanonical=PENDING / processing=true   → 继续轮询（退火 1s→5s）
      └─ processing=false                            → 终态
4. 读 statusCanonical + runtime + memory      → 映射为 AC/WA/TLE/MLE/RE/CE
5. (可选) GET /status/data?...                → 批量记录 / 题单进度统计
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
5. **凭据安全**：绝不在代码、配置、日志、Git 历史中写入 VJudge 或远端 OJ 的账号密码；会话 Cookie 只存系统用户数据目录，且不入版本库。**HAR / 抓包文件默认包含 Cookie 请求头**，分析完即删，仓库已用 `.gitignore` 兜底排除 `*.har`。
6. **题面版权**：抓取到的题面仅作本地个人学习展示，不要二次分发或缓存进仓库。
7. **礼仪**：集成上线前建议查阅 VJudge 站点说明/联系作者确认自动化使用边界。

---

## 9. 待验证清单（需登录态抓包）

已验证（本轮 HAR 抓包）：

- [x] 提交端点、请求体字段与响应（§6.1，含"不需要 token"这一反直觉结论）。
- [x] 结果轮询端点 `POST /solution/data/{runId}` 与全部响应字段（§6.2）。
- [x] `PENDING → AC` 的终态判定路径与耗时量级（§6.7）。

仍待补全：

- [ ] 题面正文的取回方式：题目页里承载题面的容器/接口（HTML 结构 + 是否有 JSON 端点）。
- [ ] AI 翻译的真实端点、请求体（是否复用 `crawl/tasks`）与结果轮询方式 —— JS 里**只有 i18n 文案键，没有端点字面量**，说明端点由服务端渲染的页面决定，必须抓包。
- [ ] 语言列表的数据来源（题目页内联数据？独立端点？）与各 OJ 的 id 映射（§6.5）。
- [ ] `method=1/2` 与 `open` 其他取值的准确语义与允许值。
- [ ] `statusCanonical` / `statusType` 的完整枚举（WA/TLE/MLE/RE/CE/PE/SE 等），只需对同一题故意交错/超时/越界各抓一次。
- [ ] `/problem/suggestions` 的请求参数与响应结构。
- [ ] 提交失败的错误信封样例（远端 OJ 不可用、账号未绑定、题面未抓取）。
- [ ] `/status/data` 的过滤参数名（按 `problemId` / `userName` / `oj` 过滤）。

复核方法：登录 → 打开题目页 → DevTools Network 面板记录上述操作的实际请求，把 URL / 请求体 / 响应样例回填本文对应小节，并把 `[待验证]` 改为 `[实测]`。导出 HAR 时**注意里面会带 Cookie 请求头**（Chrome 默认导出可能包含），分析完请删除，不要提交进仓库。

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

# 5) 解析登录态 HAR（只看 xhr/fetch，避免打印任何请求头）
node -e '
const fs=require("fs");const h=JSON.parse(fs.readFileSync("vjudge.net.har","utf8"));
const safe=s=>{try{return decodeURIComponent(s)}catch{return s}};
for(const x of h.log.entries){
  const rt=x._resourceType||""; if(rt!=="xhr"&&rt!=="fetch")continue;
  const u=new URL(x.request.url);
  console.log("=== "+x.request.method+" "+u.pathname+" -> "+x.response.status);
  if(x.request.postData) console.log("  BODY: "+safe(x.request.postData.text||"").replace(/\s+/g," ").slice(0,200));
  console.log("  RESP: "+safe(x.response.content.text||"").replace(/\s+/g," ").slice(0,500));
}'
```

> 本文档不含任何账号凭据。测试账号与会话信息一律不得写入仓库。
