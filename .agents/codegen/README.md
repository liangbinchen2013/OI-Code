# codegen · 代码生成器

> 定义文件：[`../codegen.md`](../codegen.md) ｜ 判据：`AGENTS.md` 第 2、3、4 节

## 职责一句话

新建服务、扩展、贡献点、IPC 协议时，生成**一次通过架构评审与代码审查**的骨架代码。

## 何时调用

- 新建平台服务（`I*` 接口 + 实现 + 注册）
- 新建内置扩展（`libs/extensions/*`）
- 新建贡献点（`contrib/`）
- 新建 IPC 协议（`libs/platform/ipc/`）
- 新建 Electron 主进程 / CLI / Server（`Code` 层入口）

## 工作流程

1. **判层**：先写明文件属于哪一层，写不出来就不动手。
2. **找样板**：`Glob` / `Grep` 找同层既有实现，模仿其结构与风格，不引入项目里不存在的库。
3. **定契约**：`interface` 描述契约、`type` 描述联合，接口先行。
4. **生成骨架**：按约定目录（`common/` `browser/` `node/` `contrib/`）落盘。
5. **自查**：对照产出清单逐项打勾。
6. **交接**：汇报文件清单，提示人类调用 `architect` 与 `reviewer`。

## 产出清单（摘要）

- [ ] 层级归属正确，无反向 import
- [ ] 接口 `I{Name}` + `createDecorator`，实现只经构造函数注入
- [ ] `implements IDisposable`，资源全部进 `DisposableStore`
- [ ] 同目录 `*.test.ts` 含最小用例
- [ ] 无 `any` / `@ts-ignore` / `console.*` / 静默 `catch`
- [ ] `npm run valid-layers-check` 通过

## 服务骨架目录示例

```
libs/platform/<feature>/
  common/<name>.ts        # 接口 + createDecorator
  browser/<name>.ts       # 浏览器实现（如需）
  node/<name>.ts          # Node 实现（如需）
  common/<name>.test.ts   # 与源文件同目录
```

## 协作顺序

```
人类提出需求 ──► codegen 生成骨架 ──► architect 结构评审 ──► reviewer 提交前审查
```

## 边界

不自行提交、不自行删除既有文件；发现结构问题只报告不擅改；`AGENTS.md` 与 `.agents/` 文档未经人类确认不得改动。
