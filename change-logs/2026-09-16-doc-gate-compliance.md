# 文档门禁恢复：改动记录引用格式与生成产物

- **完成时间**：2026-09-16
- **分支**：`master`
- **Commit**：
  - docs(change-logs): drop repository commit identifiers from record metadata
  - chore(catalogs): regenerate the cordis and persistence catalogs
  - （本条记录、目录索引与根 README 计数随第一笔提交落地，配对 hash 由 `verify-translation-pairing --write` 重新录制。）

## 摘要（Abstract）

`pnpm run doc-sync` 原先报 6 个门禁失败：9 条改动记录的元信息携带仓库 commit 标识符，cordis 与 persistence 两份目录产物落后于源码。本次按 `docs/AGENTS.md` 的参考链接规范把记录中的标识符换成提交主题行，修正 `change-logs/AGENTS.md` 里与之冲突的条文，并用仓库生成器重算全部产物。门禁结果从 35 passed / 6 failed 变为 40 passed / 1 failed，唯一剩余失败与内容无关，是 Windows 非管理员环境下创建符号链接的 `EPERM`。

## 背景（Background）

`scripts/verify-repository-references.ts` 拒绝 maintained 文件中的仓库 commit 标识符，历史证据要求使用发行 tag 与 PR、运行或 job 标识，该规则由 Agent Note「Maintained repository references」确立并在 `docs/AGENTS.md` 中陈述。`change-logs/AGENTS.md` 却要求每条记录列出 40 位或可唯一识别的 commit 前缀，两条规则直接冲突，使 9 条记录共 22 处引用持续失败；`verify-cordis-catalog`、`verify-persistence-catalog` 与 `verify-persistence-changes` 同时报产物过期，`verify-translation-pairing` 与 `verify-repository-references` 还被仓库根目录下的未跟踪草稿文件触发。

## 改动过程（Process）

### 改动记录（change-logs/）

9 条记录的元信息去掉 commit 标识符：分支基线改写为「基于当时的 master / origin/master」，提交列表保留主题行，例如 `feat(cli): add dsh plugin check for local bundle validation`。记录正文、小节结构与验证结论不变。

### 规范（change-logs/AGENTS.md）

「Commit 列表」一节改为「提交列表」：按时间顺序列出提交主题行，历史证据使用发行 tag 与 PR、运行或 job 标识，并链接 Agent Note 与该门禁；检查清单与提交前命令加入 `verify-repository-references`；「只增不改」补充引用格式不合门禁时就地改写引用的例外。

### 生成产物

`pnpm run gen-cordis-catalog` 重算 `packages/extensions/tool-cordis/src/api-catalog.ts`、`docs/subsystems/tools.md` 与 `docs/subsystems/tools.zh.md`，补上对象根可组合 `oneOf`/`anyOf` 的注册期描述；`pnpm run gen-persistence-catalog` 重算 `docs/persistence-catalog.md`、`docs/persistence-catalog.zh.md`、`docs/persistence-catalog.i18n.yaml` 与 `docs/persistence-schema.json`，同步 `session-title-llm`、`agent-team` 等源码的当前行号。

### 未跟踪草稿

`verify-translation-pairing` 与 `verify-repository-references` 的语料包含未跟踪且未被忽略的新文件，仓库根目录下的个人草稿（Agent Team 知识卡、结构图、测试叠加层与 `team-verify/`）因此各触发一处失败；这些文件不属于仓库内容，已移出工作树，未删除。

## 总结（Summary）

仓库树的文档门禁恢复：引用检查、翻译配对与两份目录一致性全部通过，`change-logs/AGENTS.md` 不再要求 commit 标识符，后续记录不会重复引入同类失败。剩余唯一失败是 `scripts/project-doc-site.spec.ts`「拒绝真实路径逃逸的目标」用例在本机创建符号链接失败，需要开发者模式或管理员权限，属平台限制。

## 验证（Verification）

- `pnpm run doc-sync`：40 passed / 1 failed（修正前 35 passed / 6 failed）。
- 失败项 `pnpm exec vitest run scripts/project-doc-site.spec.ts scripts/verify-doc-site-fragments.spec.ts website/tests/mermaid-viewer.spec.ts`：1 failed / 82 passed，失败行为 `EPERM: operation not permitted, symlink`。
- 平台归因：`New-Item -ItemType SymbolicLink` 在本机报「此操作需要管理员权限」，`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock\AllowDevelopmentWithoutDevLicense` 未设置，故该用例需要开发者模式或管理员环境。
- 复现命令：`pnpm run doc-sync`，单点复核用 `pnpm run verify-repository-references`、`pnpm run verify-cordis-catalog`、`pnpm run verify-persistence-catalog`。
