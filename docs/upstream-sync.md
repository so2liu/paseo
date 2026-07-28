# 上游同步

本 fork（`so2liu/paseo`）从上游 `getpaseo/paseo` 同步的完整流程。选基线的规则和
必须遵守的红线写在 [CLAUDE.md](../CLAUDE.md) 的 fork 一节，这里是执行细节。

## 选基线

取**上游最新的 release tag，按发布时间排序**，不看 channel —— beta 和 stable
平等竞争。

```bash
git fetch upstream --tags
gh release list --repo getpaseo/paseo --limit 10
```

取列表最上面那个。两个方向的错都要避免：不要为了等 stable 而跳过更新的 beta，
也不要默认最新的一定是 prerelease。

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
git switch -c sync/upstream-v<版本>
git merge v<版本>
```

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

只有当文件完全属于上游、fork 从没碰过时 `--theirs` 才安全，而且要先证明：

```bash
git log v<基线>..HEAD -- <文件>   # 输出为空才算证明
```

`CHANGELOG.md` 就属于这一类。

### 各类冲突的处理

| 冲突                     | 处理                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `package.json` 版本号    | 取上游版本号，只改那几行。manifest 跟随上游，见 [development.md](development.md#custom-fork-build-identity) |
| `package-lock.json`      | 取上游整份，然后跑 `npm install` 调和                                                                       |
| `CHANGELOG.md`           | 取上游整份（fork 不写这个文件）                                                                             |
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

合并后逐个 grep，别假设：

- 火山引擎 STT provider（`packages/server/src/server/speech/providers/volcengine/`）
- SQLite timeline store（`packages/server/src/server/agent/sqlite-agent-timeline-store.ts`）
- `mermaid` 依赖（`packages/app/package.json`）
- `so2liu` 更新源（`packages/desktop/electron-builder.yml`）
- fork 的 Expo 项目 ID（`packages/app/app.config.js`）
- idle TTL 一小时（`packages/server/src/server/bootstrap.ts`）

## 同步之后

**LY 序号重新从 1 开始。** 同步到 `0.2.3` 之后下一个 fork 版本是 `v0.2.3-LY.1`，
不是接着 `LY.3`。版本号规则见 [fork-releases.md](fork-releases.md)。

**同步 PR 保持忠实。** 不要在同步 PR 里修上游代码的问题 —— diff 会不再如实反映
"上游改了什么"，而且会在代码里留下 fork 专属分歧，之后每次同步都要重新处理这个
冲突点。协议层尤其如此。上游的问题走上游 issue。
