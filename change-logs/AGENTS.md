# AGENTS.md — 改动记录规范

本目录（`change-logs/`）保存本仓库每次改动的背景与过程记录。任何对本仓库
代码、文档或配置的实质改动，都应在完成后补一条改动记录。

## 基本原则

- **每次改动一条记录**：一个"改动"指一次有明确目标、可独立描述的变更，
  可以包含多个 commit（例如一个改进分支的全部提交）。
- **先改后记**：改动完成并验证通过后，才写记录；内容必须反映实际发生的
  过程与真实验证结果，不得虚构。
- **中文撰写**：记录默认用简体中文，术语可保留英文原文。
- **只增不改**：已发布的记录文件不修改；如需更正，在该文件末尾追加
  "更正"小节。

## 文件命名

每条记录一个 Markdown 文件，放在 `change-logs/` 根目录：

```
YYYY-MM-DD-<作用-slug>.md
```

- `YYYY-MM-DD`：改动完成日期（验证通过日）。
- `<作用-slug>`：英文短横线概括改动作用，例如 `tool-schema-contract`。
- 同一天多条记录时，在日期后追加 `-HHMM`（如 `2026-08-14-1520-...`）区分。

## 记录文件结构（论文式）

每个记录文件按以下小节组织：

1. **标题**：`# <改动作用>`，一句话概括本次改动。
2. **元信息**：完成时间、分支、本次改动包含的全部 commit（hash + 主题行）。
3. **摘要（Abstract）**：一段话概括改了什么、解决什么问题、结果如何。
4. **背景（Background）**：为什么做这次改动（问题、来源、约束）。
5. **改动过程（Process）**：分步描述实现过程、关键问题与解法、涉及的主要
   文件与机制。
6. **总结（Summary）**：改动带来的效果、边界与遗留问题。
7. **验证（Verification）**：实际运行的验证命令与结果摘要，以及可复现的
   命令。

## Commit 列表

记录文件必须列出本次改动包含的全部 commit hash（完整 40 位或可唯一识别
的前缀），按时间顺序，附主题行。

## 目录索引（README.md）

- 每新增一条记录，必须同步更新 `change-logs/README.md`：
  - 按完成时间**最新在前**排序；
  - 每条目：日期 + 一句话概括 + 指向记录文件的链接。
- 同时更新仓库根 `README.md` / `README.zh.md` 开头的改动计数（"已进行
  N 个改动，具体信息在 change-logs/ 下"），并运行
  `pnpm run verify-translation-pairing --write README.md` 重新录制配对
  hash。

## 提交规范

- 记录文件、索引与 README 计数改动同属一个 commit，message 使用仓库的
  conventional 风格（如 `docs(change-logs): ...`）。
- 默认不推送；只有用户明确要求时才 `git push`。
- 提交前运行：`pnpm run verify-translation-pairing` 与
  `pnpm run verify-md-links`。

## 检查清单（每次新增记录时）

- [ ] 文件名符合 `YYYY-MM-DD-<slug>.md`
- [ ] 包含 commit hash 列表
- [ ] 小节齐全：元信息 / 摘要 / 背景 / 改动过程 / 总结 / 验证
- [ ] 索引 `README.md` 已更新（时间倒序）
- [ ] 根 README 计数已更新且配对 hash 已录制
- [ ] 门禁通过：`verify-translation-pairing` / `verify-md-links`
