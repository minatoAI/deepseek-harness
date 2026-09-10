# Agent Note: Session fork 排除下一轮 inbox

Status: implemented

[English](2026-09-10-session-fork-excludes-next-turn-inbox.md) | 中文

## 问题

分支中间轮次时会把下一轮的输入一起复制到子会话。存活日志把下一轮的 `agent/inbox/spliced` 插入事件放在 `turn/end` 与下一个 `turn/start` 之间，控制器向下一个 `turn/start` 推进的截断逻辑因此把该插入也含了进去。子会话把它重建为排队的 `next-turn` 工作：把 3 轮会话的前 2 轮分支出来后，第 3 轮的提示词会以排队形态留下，再发一条新消息就会出现两条排队消息。

## 决策

`SessionCommandController.fork` 的尾部扫描在第一个 `turn/start` 或 `agent/inbox/spliced` 处停止。`turn/end` 之后稳定的尾部元数据仍属于被分支前缀，会被包含；同一间隙里的 inbox 插入属于下一轮，会被排除。seed 因此止于被分支的 `turn/end` 及其尾部元数据，与 `SessionStore.fork` 的截断一致。

## 测试

`sessions.fork` 主机套件构造每轮都带真实 inbox 插入/认领对的三轮源会话，分支中间的 `turn/end`，并断言子会话只含前两轮加 `session/end-seed`，且不含 `prompt 3` 载荷。相邻的 `SessionStore.fork`、控制器创建/分支失败与客户端 fork 套件保持通过。

## 考虑过的替代方案

**直接在 `boundary.seq + 1` 截断，不做尾部扫描。** 否决：已关闭轮次之后追加的稳定纯日志事件（例如 `SessionStore.fork` 套件钉住的请求元数据）属于被分支前缀，直接截断会丢掉它们。

**切片后再从 seed 里过滤 inbox 插入。** 否决：截断位置是谱系契约（`inheritedEventCount`）；事后过滤会让截断位置指向子会话并不拥有的事件。

**只把 `next-turn` 插入视作下一轮所有。** 否决：`turn/end` 到 `turn/start` 间隙里的任何 inbox 拼接都是为尚未开始的轮次做的队列管理，只处理其中一种目标会给另一种留下同样的泄漏。

## 后果

中间轮次的分支不再携带后续轮次的排队输入；在子会话里发送会开启且仅开启一个新轮次。末轮分支不受影响，因为后面不存在 inbox。之前已因泄漏带上排队消息的子会话保持原样，不会被追溯修复。
