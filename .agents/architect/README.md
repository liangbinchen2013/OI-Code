# architect · 架构守卫

> 定义文件：[`../architect.md`](../architect.md) ｜ 判据：`AGENTS.md` 第 2、7 节

## 职责一句话

在**任何结构性变更前/后**校验分层依赖、多进程隔离、DI 与资源生命周期，出具带 `file:line` 的评审报告，违规即阻断。

## 何时调用

| 场景 | 时机 |
|------|------|
| 新增/移动/重命名跨层文件 | 变更**之后** |
| 新建服务 / 扩展 / 贡献点 / IPC 协议 | 变更**之前**结构评审 + **之后**复核 |
| 改动 Extension Host / 渲染进程 / 主进程边界 | 变更**之后** |
| 改动 DI 注册、`DisposableStore`、订阅与句柄 | 变更**之后** |
| 提交 / 发 PR 前 | 结构终审 |

## 输入

- 本次变更范围（文件列表或 `git diff`）
- 变更所属层级（Base / Platform / Editor / Workbench / Code）

## 输出

`## 架构评审报告`：结论（✅ 通过 / ❌ 阻断）+ 违规表（等级 / 位置 / 违反规则 / 问题 / 修复建议）+ 已执行的校验说明。

## 工作方式

1. 必跑 `npm run valid-layers-check` 取机器判定。
2. 用 `Grep` / `Glob` 人工核查机器查不到的项（进程边界、DI 写法、`DisposableStore`）。
3. 每条结论必须给 `file:line`，不接受"感觉式"判定。

## 协作顺序

```
codegen 生成骨架 ──► architect 结构评审 ──► reviewer 提交前审查 ──► 人类确认后提交
```

## 边界

只报告、不擅改；`AGENTS.md` 与 `.agents/` 文档**必须经人类确认**才能修改（13 号红线）；判据歧义时停下询问。

## 相关命令

```bash
npm run valid-layers-check   # 分层校验（核心依据）
pnpm lint
nx affected:test
```
