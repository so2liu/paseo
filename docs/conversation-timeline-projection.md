# 长对话打开即可读：折叠按提问索引切分

## 要解决的问题

一个 turn 的结构通常是「提问 → 上百条工具调用 → 一段结论」。owner 关心提问和结论，
90% 以上的情况不看中间过程。

桌面端打开长对话时，时间线从最新往回分页，于是：先看到结论和它前面几十条**没有折叠**的
工具调用，一路往前翻完整整上百条，直到最开头那条提问加载出来，折叠才突然生效。

根因：折叠分组按**已加载的**提问切分 turn，而提问是向前分页时最后才到的那一行。
这个功能在最需要它的场景下恰好不生效。

手机端不受影响：native 走 mobile lite，`projectMobileLiteStream` 在**渲染层**就滤掉了
`tool_call`，折叠在 native 上本来就是关的。

## 采用的做法

### 1. 折叠边界改用 daemon 的提问索引

`agent.timeline.list_prompts`（`features.agentTimelinePromptIndex` 门控）**不分页返回整段
对话每条提问的 seq**，而且打开对话时本来就会拉它。`buildExecutionCollapseProjection` 新增
可选入参 `promptSeqs`：有索引时按真实 turn 边界分组，没有时退回按已加载提问切分。

收益：

- 提问那一行还没加载，也能正确分组 —— 打开就是「折叠块 + 结论」
- 分组 id 变成 `execution-collapse:prompt:<seq>`，**翻页时不变**，展开状态不再被每次加载清掉
- 「这一轮是否已结束」由索引里有没有更晚的提问决定，比只看窗口准确

### 2. 索引仍然跟随「聊天大纲」开关

索引现在服务两个功能，一度想让拉取只跟随 host 能力、把设置留给大纲条的渲染。**这条不能做**：
服务端的 `agent.timeline.list_prompts` 处理器无条件调用 `ensureAgentLoaded`，冷路径会恢复
provider 进程并重放它的历史。若对每个打开的 agent 都拉索引，仅仅查看一段已缓存的对话就可能
拉起一个 provider。

所以拉取仍然是 `supportsChatOutline && chatOutlineEnabled`：**关掉聊天大纲，折叠也会退回按
已加载提问切分**。要解除这个耦合，得先把索引接口改成只读持久化存储、不加载 agent。

### 3. 首屏加载量单独调大

`TIMELINE_INITIAL_TAIL_PAGE_SIZE = 200`，增量分页仍是 `TIMELINE_FETCH_PAGE_SIZE = 40`。
daemon 对 tail 请求默认就给 200，所以没有要求它做新的事。

**不要用 `limit: 0`** —— sqlite store 会翻译成无 LIMIT，超长会话会通过 relay 推一个巨大的
加密帧。

## 为什么没有做「服务端只发对话行」

最初的方案是给时间线拉取的 `projection` 参数加一个 `conversation` 值，让服务端过滤掉
执行行。三个视角的对抗性评审逐条对着代码否掉了它，结论是**代价从"加一个投影模式"变成
"重写时间线同步内核"**。留档如下，避免以后有人再想一遍：

| 当时的判断                               | 实际                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 客户端已支持离散区间，不用改覆盖模型     | `mergeTimelineCoverage` 的 `retainedRanges` 是**多个实心段**，段内必须稠密。过滤页会让 store 谎报整段已加载                         |
| seq 断层就是隐藏条数，不需要额外协议字段 | 原始行是**分片级**的（一次工具调用占多条非相邻 seq，长文本被切块落库），断层算出的数比 `countLogicalItems` 大一个量级，甚至可能为负 |
| 展开时按 seq 区间回取，形状现成          | 请求 schema 里只有 direction/cursor/limit，**没有闭区间**；`planTimelinePromptJump` 的窗口由条数决定                                |

两条当时完全没想到的致命问题：

- **直播会死循环**：`classifySessionTimelineSeq` 硬性要求 `seq === endSeq + 1`，过滤后每条被
  滤掉的行都制造一次 gap，真正要显示的助手消息被丢弃并触发 catch-up；而
  `planTimelineCatchUpAfter` 写死 `projection: "projected"`，把刚滤掉的行全量回吐。
  **正在跑的 turn 会停止更新。**
- **向前分页整页被拒**：`acceptOlderTimelineUnits` 断言 `responseEndSeq === startSeq - 1`，
  过滤页几乎不可能满足；叠加 `page.startSeq > window.minSeq`（window 是整库 min/max）恒真，
  `hasOlder` 永远为真，构成无限重复请求。

另外「把 `isMobileLiteStreamItem` 提到协议侧共享」在类型上不成立：它吃的是客户端水合后的
`StreamItem`，判据 `activityType === "error"` 在线协议里不存在（wire 上是 `type: "error"`）。
native 是**渲染层**过滤，store 里始终是完整连续的行 —— 所以「native 已经这么干且工作正常」
不能给传输层过滤背书。

### 如果将来仍要做（几乎只剩 native relay 省流量这一个理由）

开工前必须先定死，而不是"注意"：游标与覆盖的稀疏语义二选一；直播定为服务端按连接过滤推流
并提供跳跃证明，同步改写 `classifySessionTimelineSeq`；`hasOlder` 由「过滤后是否还有更早的
对话行」单独计算；计数由服务端按逻辑条目口径给显式字段；`limit` 的双重语义拆开；请求 schema
新增闭区间下界；六条拉取链路（tail/before/after/catch-up/prompt-jump/expand）逐条写死投影
模式 —— 如果这张表填不出"只有一处能力检测"的形状，说明该特性不符合仓库规约，应换路线。

## 验收

打开任意长度的对话，不滚动就能看到最近若干轮各自的提问和完整结论；中间过程是可展开的
折叠块；往前翻只让折叠块变大，不会冒出成片的工具调用。
