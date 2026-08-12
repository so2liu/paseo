# 上游同步

本 fork（`so2liu/paseo`）从上游 `getpaseo/paseo` 同步的完整流程。选基线的规则和
必须遵守的红线写在 [CLAUDE.md](../CLAUDE.md) 的 fork 一节，这里是执行细节。

## 选基线

取**上游最新的 release tag，按发布时间排序**，不看 channel —— beta 和 stable
平等竞争。

```bash
git fetch upstream --tags
gh release list --repo getpaseo/paseo --exclude-drafts --limit 200 \
  --json tagName,publishedAt,isPrerelease \
  --jq 'sort_by(.publishedAt) | reverse | .[0]'
```

两个方向的错都要避免：不要为了等 stable 而跳过更新的 beta，也不要默认最新的一定
是 prerelease。

`--exclude-drafts` 不能省。草稿 release 默认会混在列表里，但它未必有能拉取的
tag，被选中就会卡住整个同步。

`--jq` 的排序也不能省：列表的默认顺序不保证是发布时间序。同理 `--limit` 要给足
（上游目前不到 200 个 release）—— `--limit` 限制的是**取回多少条**，截断发生在
排序之前，给小了等于用没保证的默认顺序先筛一遍，再对筛剩的排序，那前面的排序就
白做了。

这条规则替代的失败：早先的版本写的是"从最新 beta tag 同步"，而在 `v0.2.3` 时
上游剩下的 prerelease（`v0.2.0-beta.4` 及更早）全都比它旧，照做会倒退一整条
minor 线。

**永远不要从 `upstream/main` 或裸 commit SHA 同步。** `main` 上是未发布未稳定的
代码，拿它做基线等于引入上游自己都还没发给任何人的问题，而且没有版本号可供我们
的 `-LY.N` 序列锚定。基线永远是 tag。"最新的 release 是一周前的，那我直接拿
main" 不成立 —— 一周前就是正确基线。

## 合并

用 merge，不用 rebase。fork 有几十个自定义提交，rebase 代价大且容易丢东西。

```bash
git fetch origin
git switch -c sync/upstream-v<版本> origin/main
git merge v<版本>
```

分支必须**显式从 `origin/main` 建**。`git switch -c` 不带起点时是从当前 `HEAD`
分出去的，如果开始同步时正好停在某个功能分支或过期的 checkout 上，同步 PR 就会
夹带无关提交、或者缺掉别人刚合进 main 的 fork 改动——两种情况都会让这次同步的
基线不是"当前的定制化 fork 状态"。

## 解冲突

失败都是静默的 —— 丢掉的依赖、崩掉的类型，往往在合并看起来干净很久之后才暴露。
按下面的顺序做。

### 禁止用 `git checkout --theirs`（和 `--ours`）

**它替换的是整个文件，不是冲突的那几行。** fork 在该文件其它位置的改动会被
静默丢弃，没有任何警告。

`v0.2.3` 那次同步就是这么差点丢掉 `packages/app` 的 `mermaid` 依赖和
`build:mermaid-webview` 脚本：冲突只有一行版本号，整个文件却被换成了上游版本，
连带 `package-lock.json` 也整份被换，所以 `npm install` 也没装回来 —— 直到
typecheck 报 `Cannot find module 'mermaid'` 才暴露。

正确做法是直接编辑冲突标记，保留其余已合并的内容。

**没有例外。** 即使某个文件看起来完全属于上游（比如 `CHANGELOG.md`，fork 从不写
它），也不要用 `--theirs` 去解冲突。用 `git log` 做归属判断并不可靠：它会漏掉重
命名，基线选错时结论还会整个反过来，而这个命令一旦用错是完全静默的——代价和收益
完全不成比例。

确实需要整份采用上游内容时，用显式的内容替换，把意图写进命令本身：

```bash
git show v<版本>:CHANGELOG.md > CHANGELOG.md
git add CHANGELOG.md
```

区别在于：这条命令替换的是一个你明确点名的文件的全部内容，语义就是"我要整份覆盖
它"；而 `--theirs` 是把"解决冲突"这个动作偷偷变成了整份覆盖，读代码的人看不出这
一点。

### 各类冲突的处理

| 冲突                     | 处理                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `package.json` 版本号    | 取上游版本号，只改那几行。manifest 跟随上游，见 [development.md](development.md#custom-fork-build-identity) |
| `package-lock.json`      | 取上游整份，然后跑 `npm install` 调和                                                                       |
| `CHANGELOG.md`           | `git show v<版本>:CHANGELOG.md > CHANGELOG.md` 显式覆盖，不要用 `--theirs`                                  |
| 双方各加各的             | 两边都保留，通常不是真冲突（新增 capability flag、新增 import 都属于这类）                                  |
| 上游修了我们也修过的问题 | 见下面"取值比较"                                                                                            |

`package-lock.json` 取上游后跑 `npm install`，它会按合并后的 manifest 把
fork 专属依赖补回来。补完在三处确认：manifest、lockfile、`node_modules`。

### 取值比较：上游修了同一个问题时

"优先上游实现"的前提是**它覆盖了我们的行为**，不是无条件让位。先比较实际取值。

`v0.2.3` 的例子：上游把 idle agent 的 TTL 从 2 分钟提到 30 分钟，和我们
`8f927c417` 修的是同一个问题 —— 但 owner 要的是一小时，30 分钟没覆盖，所以我们
那条不算冗余修复，保留 60 分钟。同一个 hunk 里的 sweep 间隔我们从没主动改过
（15 秒只是旧基线值），取了上游的 60 秒。

## 验证

### 判断类型错误前必须完整重建

`npm run build:client` **不构建** `relay` 和 `highlight`，它们陈旧的 dist 声明会
让双方都没改过的文件报错。`v0.2.3` 同步时 `relay-transport.ts` 和
`daemon-client-relay-e2ee-transport.ts` 都是这样，`npm run build:server` 之后自愈。

```bash
npm install
npm run build:server    # 必须在 typecheck 之前
npm run typecheck
npm run lint
```

反过来也会发生：在同步分支上构建过之后切回同步前的分支，dist 比源码新，同样报
跨包声明错误。

### 语义冲突：git 合得干净但类型崩

上游给某个类型加了必填字段、而 fork 改过对应的 fixture 或调用方时，合并会成功，
类型却对不上。**`typecheck` 是唯一能抓到这类问题的手段，所以同步后它是必须项。**

`v0.2.3` 的例子：上游给 `StreamRenderInput` 加了必填的 `olderHistoryProgressKey`，
我们改过 `strategy-web.test.tsx` 的两处 fixture，按上游写法补 `null` 即可。

### 逐项复查定制

**不要依赖手写清单。** fork 的定制一直在增加，写死的列表必然滞后，而它带来的"我
已经查过了"的错觉比没有清单更危险。作为量级参考：`v0.2.2` 到同步前，fork 自己的
提交有 52 个，任何手写清单都只列得到其中几个。

正确做法是从历史推导本次真正有风险的范围——**碰过上游本次改动文件的 fork 提交**。
把上游改动的文件当作 pathspec 传给 `git log`，一条命令直接算出来：

```bash
git diff --name-only --no-renames <上次基线>...<新基线> > /tmp/upstream-changed.txt
git log --oneline <上次基线>..<同步前的 main> --full-history -- $(cat /tmp/upstream-changed.txt)
```

`--no-renames` 不能省。默认的改名检测会把一次重命名合并成一条记录、只输出**新**
路径；如果某个 fork 提交是在旧路径下改的，后面按路径过滤的 `git log` 就完全匹配
不到它，这条定制会被静默漏掉。加上 `--no-renames` 后重命名会拆成"删旧 + 加新"，
新旧路径都在列表里。

**不要加 `--no-merges`**，要加 `--full-history`。历次同步的 merge commit 里存放着
上一轮的冲突解决，这些改动在两个父提交里都不存在、只存在于合并本身，`--no-merges`
会把它们整个跳过；而 `git log` 带 pathspec 时默认还会做历史简化，同样可能把相关
的合并剪掉，所以要用 `--full-history` 关掉简化。实测 `v0.2.3` 这次：`--no-merges`
出 25 条，`--full-history` 出 28 条，多出来的正是 `7ae07083b`（合并 v0.2.2）和
`01b64c6a9`（同步 v0.2.0-beta.4）这两次同步的合并提交——恰恰是最需要复查的那类。
多出的三条噪音可以忽略。

第二条命令的输出就是需要逐个确认的 fork 提交。注意两条命令不能各跑各的再"人肉
求交集"——前者输出文件路径、后者输出提交，两种东西对不上；必须像上面这样把路径
喂给 `git log` 当过滤条件，让 git 来算。

`v0.2.3` 那次的实际数字：上游改了 211 个文件，fork 共 52 个提交，交集是 28 个。
逐个确认这 28 个提交的行为是否还在，比通读 52 个现实得多。

这套推导是**启发式的，不是穷尽的**：它靠路径匹配，所以只在路径能对上时有效。
如果 fork 自己把某个上游文件改了名，而上游后来又改了旧路径，新路径下的后续定制
就落不进这份清单（本仓库至今没有出现过 fork 侧重命名，所以这是个理论缺口，但别
把清单当成证明）。正因如此，下面这份单独确认清单不能省：

- 火山引擎 STT provider（`packages/server/src/server/speech/providers/volcengine/`）
- SQLite timeline store（`packages/server/src/server/agent/sqlite-agent-timeline-store.ts`）
- `mermaid` 依赖（`packages/app/package.json`）—— `v0.2.3` 那次就是从这里丢的
- `so2liu` 更新源（`packages/desktop/electron-builder.yml`）
- fork 的 Expo 项目 ID（`packages/app/app.config.js`）
- idle agent 必须常驻：从 `v0.2.5` 起，上游的无限期常驻已经完整覆盖并取代 fork
  原先的一小时 TTL；后续同步不得重新引入更短的自动回收（`docs/agent-lifecycle.md`）
- 默认排队消息（`cd38ba86b`）、native mobile lite 模式（`d137fe81e`）、
  混合项目 push token 重试（`0fe522848`）

### 机械核对：导出符号与新增文件

上面那份提交清单要人逐条回忆"这个提交的行为还在不在"，很容易看漏。补一道机械检查，
把 fork 引入的**导出符号**和**新增文件**全部拉出来，逐个确认还在合并结果里。

**被查的那个 ref 必须是合并结果，也就是同步分支上的 `HEAD`。** 复查是在同步 PR 合并
*之前*做的，这时候 `origin/main` 恰恰是同步前的 fork 状态——每个符号在那里当然都还在，
两条命令会全部通过，而它们本该抓的丢失一个都抓不到。下面用 `HEAD` 表示合并结果，在
同步分支上直接跑即可；如果是事后复查已经合掉的同步，把 `HEAD` 换成那个 merge commit。

```bash
MERGED=HEAD   # 同步分支上的合并结果；事后复查就写那个 merge commit 的 SHA

# 新增文件
git diff --name-status --no-renames <上次基线> <同步前的 main> -- 'packages/*' \
  | awk '$1=="A"{print $2}' | grep -vE '\.(md|json|lock)$' \
  | while read -r f; do git cat-file -e "$MERGED:$f" 2>/dev/null || echo "MISSING: $f"; done

# 导出符号
git diff -U0 <上次基线> <同步前的 main> -- 'packages/*/src/*' | grep -E '^\+' \
  | grep -oE '^\+export (async )?function [A-Za-z0-9_]+|^\+export (const|class|interface|type) [A-Za-z0-9_]+' \
  | grep -oE '[A-Za-z0-9_]+$' | sort -u \
  | while read -r s; do git grep -qw "$s" "$MERGED" -- packages || echo "$s"; done
```

`git grep` 的 pathspec 用 `-- packages`，**不要写 `-- 'packages/*/src'`**：后者匹配不到
任何东西，会把每一个符号都报成缺失，看起来像天塌了。

新增文件那一步会把**重命名**报成缺失（上游 `v0.3.1` 把 e2e 目录整个挪进了
`e2e/browser/` 和 `e2e/support/helpers/`）。逐个确认新路径下是否存在同名文件再下结论。

**这道检查有明确盲区：它只认符号和文件名，认不出"函数体内改了一行"的定制。**
`v0.3.1` 丢掉的移动端项目选择器就是这类——一行 JSX，没有任何新符号。值类定制
（默认值、上限、开关）只能靠上面那份手写清单和人工核对。

### `v0.3.1` 那次的实际结果

按上面两道检查跑完：上游改了 1557 个文件，交集 fork 提交 87 个，fork 引入 159 个
导出符号 / 75 个新增文件。丢了两处：

1. **移动端新建工作区的项目选择器**（一行 JSX）。合并前两边都有这一行，解冲突时取了
   上游新增的 `launchControl`、保住了 fork 的"主机在前"顺序，唯独把项目那一行漏掉。
   桌面端分支不受影响，所以在 Mac 上完全看不出来，一路走到了发版。已在 `#42` 修复，
   并补了手机尺寸视口的 e2e——**移动端和桌面端是 `isCompact ? ... : ...` 两个独立分支，
   桌面端的断言证明不了移动端**。
2. **原生聊天记录的手势/滚动模块**（`native-history-scroll-intent`、
   `native-history-layout-invalidation`，及 `disarmHistoryStartPagination`、
   `planResumeTimelineSync`）。这块**决定不恢复**：上游在 `v0.3.1` 把
   `history-start-pagination` 换成了 `dormant/ready/loading/settling/latched` 状态机，
   fork 那些补丁是在旧地基上修出来的，硬贴回去等于跟上游对着干。这一块以上游为准。
   web 侧的 `web-history-input.ts` 一行没丢，不受影响。

从这两处得到的判断口径：**丢了"我们加的功能"要补回来；丢了"我们在旧实现上打的补丁"、
而上游已经重写了那块实现，就以上游为准。**

## 合并同步 PR

**必须用 merge commit，绝对不能 squash。** 这是整个流程里最容易一键毁掉、而且当场
看不出任何异常的一步。

```bash
gh pr merge <PR 号> --repo so2liu/paseo --merge --delete-branch
```

原因：squash 会把整个分支压成一个只有单亲的普通提交，main 上就不再记录"`v0.2.3`
这个 tag 被合并过"这件事。Git 算下一次同步的 merge base 时会一路退回到更早的基线，
于是 `git merge v0.2.4` 会把这次已经逐个解决过的冲突**原样重演一遍**——这次花在
解冲突上的所有工作全部作废，而且下次的人根本不知道这些冲突上次是怎么解的。

`--rebase` 同样不行，理由一样：合并关系没了。

注意这和本仓库其它 PR 的习惯相反。普通 PR 用 squash 是对的，历史干净；**只有同步
PR 是例外**，而 GitHub 网页上的默认按钮很可能就是 Squash，手一快就点下去了。

合完立刻验证合并基线还在：

```bash
git switch main && git pull
git merge-base --is-ancestor v<版本> main && echo "基线 OK" || echo "基线丢了"
```

这条要当场跑。一旦被 squash 掉，事后没有干净的补救办法——只能靠下次同步时重解一遍
全部冲突，或者手工造一个假的合并提交。

## 同步之后

**LY 序号重新从 1 开始。** 同步到 `0.2.3` 之后下一个 fork 版本是 `v0.2.3-LY.1`，
不是接着 `LY.3`。版本号规则见 [fork-releases.md](fork-releases.md)。

**同步 PR 保持忠实。** 不要在同步 PR 里修上游代码的问题 —— diff 会不再如实反映
"上游改了什么"，而且会在代码里留下 fork 专属分歧，之后每次同步都要重新处理这个
冲突点。协议层尤其如此。上游的问题走上游 issue。
