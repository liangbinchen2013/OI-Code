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

VJudge 不是传统 OJ：**它把远端 OJ 的题目抓取到本地库，再把用户的代码"模拟提交"到远端 OJ，并回爬判题结果**。`/util/cfg` 实测登记 **62 个远端 OJ，其中 45 个 `isAlive`** `[实测]`：

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

**登录需求矩阵**（实测）：

| 需要登录 | 匿名可用 |
|----------|----------|
| `GET /problem/{OJ}-{id}`（题目页 HTML，含 `dataJson`） | `GET /util/cfg`（OJ / 语言 / 题面语言表） |
| `POST /problem/submit/...`、`POST /solution/data/...` | `GET /problem/description/{descKey}`（题面与各语言译本） |
| `GET /problem/suggestions` | `GET /problem/info/{OJ}-{id}`、`GET /problem/data`（题目列表） |
| 比赛 / 题单 / 抓取任务管理 | `GET /user/solveDetail/{username}`（通过记录） |

> 含义：**读题面、读译本、读配置可以完全匿名**；只有"进题目页拿 descKey / 提交 / 查自己的判题"需要登录态 Cookie。

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

### 4.2 题面正文 `[实测]`（**无需登录**）

```
GET /problem/description/{descKey}      → 200，正文形态随站点而异
```

**同一个端点有两种正文**，必须都处理：

1. **自包含 HTML 文档**（POJ / CodeForces 等）：含 `<head>`、主题脚本与 MathJax，VJudge 前端用 `<iframe id="frame-description">` 装载。POJ 题面常见 `<div class="ptx">`。
2. **JSON 分节文档**（洛谷等，`[实测]` 洛谷-P1001）：整份响应正文就是

   ```json
   {
     "lang": "zh",
     "trustable": true,
     "sections": [
       { "title": "Background", "value": { "format": "MD", "content": "不熟悉算法竞赛的选手请看这里：\n\n…" } },
       { "title": "Description", "value": { "format": "MD", "content": "## 题目描述\n\n…" } }
     ]
   }
   ```

   - `value.format`：`MD`（`content` **已是 Markdown**）或 `HTML`（需转 Markdown）；
   - `content` 里的换行与尖括号是 **JSON 转义**（`\n`、`\u003c`、`\u0026`），必须由 `JSON.parse` 解码，绝不能把原始响应正文当文本渲染；
   - `sections[].title` 是英文分节名（`Background` / `Description` / `Input Format` / `Sample Output` / `Hint`），与正文语言无关；正文可能自带 `##` 标题。

> **踩坑记录**：早期把该端点一律当 HTML 转换，洛谷题面就变成一整坨带字面量 `\n`、`\u003c` 的 JSON 文本。归一化实现见 `libs/platform/src/common/vjudgeMarkdown.ts` 的 `statementTextToMarkdown`。

`descKey` 是**"题目 × 语言版本"的键**，不是 `pid`，必须从题目页的 `dataJson.descBriefs` 取得（见 §4.3）。

### 4.3 题目页内联状态 `dataJson` `[实测]`

```
GET /problem/{OJ}-{probNum}      → 需登录（303 跳登录页）
```

页面里有一块隐藏节点承载全部结构化数据：

```html
<textarea style="display:none" name="dataJson">{ ... }</textarea>
```

实测（`POJ-1182`）字段：

| 字段 | 含义 / 示例 |
|------|-------------|
| `problemId` | VJudge 内部题号（此题 `14789`；注意与 `/problem/info` 的 `pid` 不是同一维度） |
| `oj` / `prob` | `"POJ"` / `"1182"` |
| `descBriefs` | **题面版本数组**，见 §5；每项含 `key`（即 `descKey`）、`lang`、`type`、`author`、`version`、`official`、`mainOfficial`、`publicVisible`、`remarks` |
| `properties` | 题面属性数组：`time_limit`（`"1000 ms"`）、`mem_limit`（`"10000 kB"`）、`source`（HTML）——**时限/内存限制可直接解析** |
| `submitMethods` | `[true,true,true]`：三种提交方式（对应 `method` 0/1/2）是否可用 |
| `statistics` | `[["users","11553 / 12976"],["","14709 / 18056"],["submissions","45215 / 149842"]]`（本地/远端通过数与提交数，含 HTML） |
| `mySols` | 我的提交摘要：`[[runId, status, 时间戳, statusClass, statusCanonical]]` |
| `crawling` / `hasStatementAccess` / `visibility` / `accepted` / `attempted` / `isFav` / `solutionCount` / `username` / `status` | 题目状态与当前用户上下文 |

> **集成要点**：`descKey`、时限内存、可用提交方式都只在这份登录态 HTML 里。若不想依赖登录，可用 §4.1 的 `pid` + 已知 `descKey` 直接取题面，但**首次拿到某题的 `descKey` 仍需一次登录态请求**。

### 4.4 题面抓取任务（题面缺失 / 重新抓取）`[bundle]`

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

### 4.5 题目列表（搜索 / 浏览）`[实测]`（**无需登录**）

```
GET /problem/data?draw=1&start=0&length=20&sortDir=desc&sortCol=7&OJId=POJ&probNum=&title=&source=&category=all
```

DataTables 信封，记录字段（节选）：`id`、`originOJ`、`originProb`、`visibility`、`solvedUsers`、`available`、`source`（HTML）。可按 `OJId` / `probNum` / `title` / `source` / `category` 过滤，`sortCol` + `sortDir` 排序。

### 4.6 题目搜索建议 `[实测]`（需登录）

```
GET /problem/suggestions?q={关键词}
→ 401 {"error":{"i18nKey":"user.error.login_required","trustable":false}}
```

### 4.7 全局配置 `/util/cfg` `[实测]`（**无需登录**）

```
GET /util/cfg
```

一次请求拿到全站元数据，**集成应当先拉它并缓存**（响应带 `version` 可用于失效判断）：

| 字段 | 内容 |
|------|------|
| `remoteOJs` | **62 个远端 OJ**（实测 45 个 `isAlive`）：`{name, homepage, faviconUrl, isAlive, languages, credentialTypes, vapt}`。`credentialTypes` 如 `["browser_session","username_password"]` 说明该 OJ 支持哪种账号绑定方式 |
| `remoteOJs[OJ].languages` | **该 OJ 的提交语言表 `{语言id: 显示名}`** —— 见 §6.5，POJ 实测 `0 = "C++98 (MinGW GCC 4.4.0)"`，与提交响应完全对应 |
| `languages` | 20 个规范语言名（`CPP`/`PYTHON`/`JAVA`/`RUST`/`GO`…） |
| `statementLanguages` | **23 种题面语言**（`en,zh,ja,ru,es,vi,ar,pt,id,ko,kk,az,bn,de,fa,fr,hi,it,pl,ro,th,tr,uk`）—— 翻译的目标语言枚举 |
| `cdnBaseUrl` | `https://cdn.vjudge.net.cn/`（题面图片、用户头像可能走这里） |
| `turnstileSiteKey` | 人机验证站点公钥（存在即可，集成不需要使用） |
| `version` | 配置版本号（毫秒时间戳） |

---

## 5. 题面翻译 API

**翻译不是独立接口，而是"题面多语言版本切换"** `[实测]`：题目页的 `dataJson.descBriefs` 列出该题所有题面版本，每个版本有自己的 `descKey`；点"翻译"只是把 `iframe#frame-description` 换成目标语言版本的 `GET /problem/description/{descKey}`。

抓包实证（`POJ-1182`，共 16 个题面版本）：

| `descKey` | `lang` | `type` | `author` | `remarks` |
|-----------|--------|--------|----------|-----------|
| `316632928574981` | `zh` | `main` | System | Initialization.（官方主版本） |
| `401313910919122` | `ja` | `translator` | DeepSeek | [日本語] translation by LLM (deepseek-chat) |
| `400945453243432` | `en` | `translator` | DeepSeek | [English] translation by LLM (deepseek-chat) |
| `409820260721001` | `ar` | `translator` | GPT | [اَلْعَرَبِيَّةُ] translation by OpenAI (gpt-…) |
| `366856660683060` | `en` | `translator` | GPT | [English] translation by OpenAI (gpt-3.5-turbo) |
| `386598219069603` | `zh` | `user` | hinlole | Forked from …（用户手工版） |

点击"翻译"后实际发出的唯一请求：

```
GET /problem/description/401313910919122      → 200（该语言的译本 HTML，无需登录）
```

### 5.1 版本选择规则

- `type`：`main`（官方抓取） / `translator`（LLM 翻译） / `user`（用户改写）。
- `official` / `mainOfficial`：标记主版本与官方版本；默认展示 `main` 那一项。
- `lang`：目标语言码，枚举取自 `/util/cfg.statementLanguages`（23 种）。
- `version`：毫秒时间戳，同一语言可能有多个译本（实测 `en` 有 DeepSeek 与 GPT 两份），按 `version` 取最新。
- `publicVisible`：是否对公众可见。

### 5.2 请求新译本（目标语言尚无译本时）`[待验证]`

按钮为 `<a class="gpt_translate btn btn-secondary" data-i18n-title="problem.view.translation_tip">`（文案"请求 AI 翻译"）。本次抓包的题目**已有目标语言译本**，点击未产生创建类请求，因此"发起新翻译任务"的端点仍未证实：

- 候选：复用 `POST /problem/crawl/tasks`（其 JSON 体可能带语言字段）；或独立的翻译任务端点。
- 复核方法：找一道**没有中文译本**的外文题（例如新建/冷门题），点"翻译"并抓包。

> 集成建议：先按 §5 的"读现成译本"实现（零风险、无需登录）；"发起翻译"作为可选增强，等端点证实后再接。

### 5.3 已排除的猜测 `[实测]`

`/problem/detail/{OJ}-{id}`、`/problem/translation/{OJ}-{id}` 均为 **404**；bundle 中也没有任何 `translat*` 端点字面量——翻译能力完全由服务端渲染的题目页数据驱动。

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

### 6.5 可选语言列表 `[实测]`（**无需登录**）

来自 `/util/cfg` 的 `remoteOJs[OJ].languages`（见 §4.7），结构就是 `{语言id: 显示名}`：

```json
{ "0": "C++98 (MinGW GCC 4.4.0)", "1": "C99 (MinGW GCC 4.4.0)", "2": "Java (JDK 6)",
  "3": "Pascal (FreePascal 2.2.0)", "4": "C++98 (MS VC++ 2008 Express)",
  "5": "C99 (MS VC++ 2008 Express)", "6": "Fortran (MinGW GCC 4.4.0)" }
```

- **语言 id 完全由远端 OJ 决定**，POJ 的 `0` 与 CodeForces 的 `0` 不是一回事；提交体的 `language` 就填这个 key。
- 实测自洽：用 `language=0` 提交 POJ，轮询响应回显 `"language":"C++98 (MinGW GCC 4.4.0)"`。
- 正确做法：启动时拉一次 `/util/cfg` 缓存，按 `OJ` 取表渲染下拉；用 `version` 做失效判断。切勿写死。

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
1. (可选) GET  /util/cfg                       → 缓存 OJ 列表、语言表、题面语言枚举
2. (可选) GET  /problem/info/{OJ}-{id}         → 题目存在且 crawling=false，拿标题
3. (需登录) GET /problem/{OJ}-{id}             → 解析 dataJson：descBriefs / properties / submitMethods
4. POST    /problem/submit/{OJ}-{id}           → { "runId": 73166362 }
5. POST    /solution/data/{runId}  (showCode=false)
      ├─ statusCanonical=PENDING / processing=true   → 继续轮询（退火 1s→5s）
      └─ processing=false                            → 终态
6. 读 statusCanonical + runtime + memory       → 映射为 AC/WA/TLE/MLE/RE/CE
7. (可选) GET /problem/description/{descKey}   → 题面正文：HTML 或 JSON 分节（无需登录）
   (可选) GET /user/solveDetail/{username}     → 已 AC 题号，做进度/去重
```

### 6.8 用户通过记录（"爬取记录"首选）`[实测]`（**无需登录**）

```
GET /user/solveDetail/{username}
→ 200 {"acRecords":{"POJ":["1182"]},"failRecords":{}}
```

按 OJ 分组的 AC 题号列表 + 失败记录，**体积小、无需登录**，适合做刷题进度/去重判断。

补充：

- `GET /user/solveDetail2/{username}` 为另一版本（更详细），来自 bundle `[bundle]`。
- 题目页 `dataJson.mySols` 给出当前用户在该题的提交摘要 `[实测]`。
- `GET /user/remoteAccounts/list?oj={OJ}` → `{"sessionUnlocked":false,"groups":{}}`（远端账号绑定状态，提交前检查用）`[实测]`。

---

## 7. OI-Code 落地实现（已交付首版）

已按本节实现，代码位置：

| 关注点 | 实现位置 |
|--------|----------|
| 契约与纯逻辑（OJ 匹配、状态码映射、题面版本择一、限制解析） | `libs/platform/src/common/vjudge.ts` |
| 题面正文（HTML / JSON 分节）→ Markdown | `libs/platform/src/common/vjudgeMarkdown.ts`（`statementTextToMarkdown`） |
| 渲染进程 RPC 代理 | `libs/platform/src/common/vjudgeServiceClient.ts` |
| 主进程网络实现 | `apps/desktop/src/main/vjudgeService.ts` |
| 响应解析（可单测，不依赖 electron） | `apps/desktop/src/main/vjudgeParse.ts` |
| RPC 方法/通知常量 | `libs/platform/src/common/ipc/protocol.ts`（`VJUDGE_RPC_*`） |
| 视图（活动栏一级入口，**侧边栏二级面板**） | `libs/workbench/src/browser/vjudgePanel.tsx` |
| 用户偏好与本地测试点存储 | `libs/workbench/src/browser/vjudgeSettings.ts` |
| E2E | `apps/desktop/e2e/vjudge.spec.ts` |

实现要点：

- **布局**：VJudge 是活动栏一级入口 + **侧边栏二级面板**（与资源管理器/工具箱/设置同级），
  主区始终留给编辑器——提交的是编辑器里的代码，读题与写码必须同屏；
  侧栏可拖宽读题面，窄面板下查询区纵向堆叠。
- **登录**：不模拟登录（Turnstile + CSRF 不适合纯 HTTP），在 VJudge 视图内嵌
  与内置浏览器同分区（`persist:oi-code-browser`）的 webview，用户手动登录；
  主进程经 `session.fromPartition(...).cookies.get()` 复用 Cookie，应用不存密码。
  登录态用 `GET /problem/suggestions` 探测（401 即未登录）。
- **取题**：`/problem/info`（匿名）取标题 → 题目页（需登录）解析 `dataJson`
  取 `descBriefs`/`properties`/`submitMethods`/`mySols` → `/problem/description/{key}`
  按 §4.2 归一化为 Markdown 后渲染（HTML 与 JSON 分节两种形态都支持；
  正文里夹带的 HTML 标签只改标签、不动 Markdown 结构）。
- **提交**：`/problem/submit/{OJ}-{id}`，语言表来自 `/util/cfg.remoteOjs[OJ].languages`；
  提交前可用本地测试点先跑评测机（设置中可关）。
- **回爬**：提交后主进程按 1s→5s 退火轮询 `/solution/data/{runId}`，
  经 `vjudge.submissionUpdate` 通知实时回写视图，终态或 10 分钟预算后停止。
- **记录**：`/user/solveDetail/{username}` 的 AC 题号渲染为顶部可点击胶囊。

仍未接入（等 §9 补全）：发起 AI 翻译任务、比赛/题单接口、`/problem/suggestions` 搜索下拉。
题面里的 `$…$` / `$$…$$` 公式由预览渲染器的 KaTeX 排版（非法 LaTeX 以红色原式显示、`\href` 等外链宏按 `trust:false` 拒绝，不会打断整篇渲染）。

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

已由抓包证实：

- [x] 提交端点、请求体字段与响应（§6.1，含"不需要 token"这一反直觉结论）。
- [x] 结果轮询端点 `POST /solution/data/{runId}` 与全部响应字段（§6.2）。
- [x] `PENDING → AC` 的终态判定路径与耗时量级（§6.7）。
- [x] 题面正文端点与形态：`GET /problem/description/{descKey}`，**两种形态**——自包含 HTML（POJ/CF）与 JSON 分节文档（洛谷），**无需登录**（§4.2）。
- [x] 翻译机制：`descBriefs` 多语言版本切换，含 LLM 译本元数据（§5）。
- [x] 语言列表来源：`/util/cfg.remoteOJs[OJ].languages`（§6.5）。
- [x] 题目列表与过滤参数：`/problem/data`（§4.5）。
- [x] 用户通过记录：`/user/solveDetail/{username}`（§6.8）。
- [x] 时限 / 内存限制来源：题目页 `dataJson.properties`（§4.3）。
- [x] 提交方式可用性：`dataJson.submitMethods`（§4.3）。

仍需补全：

- [ ] **发起新 AI 翻译**的端点（目标语言无译本时点 `a.gpt_translate` 才会触发）。
- [ ] `statusCanonical` / `statusType` 完整枚举（WA/TLE/MLE/RE/CE/PE/SE）——对同一题分别抓一次错解、超时、越界内存、运行时错误、编译错误。
- [ ] `method=1/2` 与 `open` 其他取值的准确行为（需先绑定远端账号）。
- [ ] `/problem/suggestions` 的参数与响应结构。
- [ ] 提交失败错误信封样例（远端 OJ 不可用、账号未绑定、题面未抓取）。
- [ ] `/problem/description/{descKey}` 是否对完全匿名也放行（本轮实测未带 Cookie 返回 200，建议再验证跨账号/未登录浏览器）。
- [ ] `dataJson` 与 `/util/cfg` 中 `vapt`、`status`、`sessionUnlocked` 等字段含义。
- [ ] 比赛（contest）与题单（workbook）相关接口（本轮未覆盖）。

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

# 6) 从题目页 HTML 抠出内联状态（题面版本表、时限、提交方式都在这里）
node -e '
const fs=require("fs");const h=JSON.parse(fs.readFileSync("vjudge.net.har","utf8"));
for(const e of h.log.entries){
  if(e._resourceType!=="document")continue;
  const m=(e.response.content.text||"").match(/name=\"dataJson\">([\s\S]*?)<\/textarea>/);
  if(!m)continue;
  const d=JSON.parse(m[1]);
  console.log(new URL(e.request.url).pathname, "→", Object.keys(d).join(","));
  console.log("  descBriefs:", d.descBriefs.map(b=>b.lang+":"+b.key+":"+b.type).join("  "));
  console.log("  properties:", JSON.stringify(d.properties.map(p=>p.title+"="+String(p.content).slice(0,24))));
}'
```

> 本文档不含任何账号凭据。测试账号与会话信息一律不得写入仓库。
