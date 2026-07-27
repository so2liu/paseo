# Fork 发版（so2liu/paseo）

本文档只描述这个 fork 自己的桌面端发版方式。上游的 [docs/release.md](release.md)
描述的是 `getpaseo/paseo` 的完整发版流程（npm 发包、网站、移动端商店构建），fork 不走那套。

## 版本号规则

fork 的版本号是 `<上游版本>-LY.<序号>`：

- `0.2.2` 是我们同步到的上游版本，跟着上游走，不自己改。
- `LY.1`、`LY.2`、`LY.3` 是在这个上游版本之上的第几个 fork 构建。
- 上游发新版后，同步完成再从 `LY.1` 重新开始（例如 `0.2.3-LY.1`）。

**分隔符必须是点号 `LY.3`，不能写成 `LY-3`。** semver 把 `LY-10` 和 `LY-3` 当作
非纯数字标识符按字符串比较，`LY-10` 会被判定为比 `LY-3` 旧，第 10 个版本起自动
更新就不再提示升级。`LY.10` 与 `LY.3` 则按数字比较，顺序正确。

`scripts/release-version-utils.mjs` 里的解析器只接受 `beta.N` 和 `LY.N` 两种
prerelease，写错格式会在 CI 第一步就报错，不会构建出错误版本。

LY 版本虽然在 semver 上是 prerelease，但它是 fork 的**正式版本**：GitHub Release
不打 prerelease 标记，channel 用 `latest`。这一点是必须的——桌面端默认在 stable
通道运行（`allowPrerelease = false`），electron-updater 此时通过
`/releases/latest` 找最新版，而这个接口会跳过所有标记为 prerelease 的 release。

## 发一个版本

```bash
git tag v0.2.2-LY.1
git push origin v0.2.2-LY.1
```

推 tag 会触发 `.github/workflows/fork-macos-release.yml`（Fork macOS Release）：

1. 在 macos-14（Apple Silicon）runner 上构建 desktop
2. 把 `packages/desktop/package.json` 的版本设成 tag 里的版本
3. 用 electron-builder 构建 arm64 的 DMG + ZIP
4. 在 **本 repo** 创建 release，上传 `.dmg`、`.zip`、`.blockmap` 和 `latest-mac.yml`

`latest-mac.yml` 是自动更新的入口清单，缺了它 App 内的"检查更新"永远看不到新版本，
所以 workflow 会显式校验它存在。

需要重新构建同一个版本时，直接手动 dispatch `Fork macOS Release` 并填 tag，
不要靠加版本号来重试。

## 更新源指向本 repo

`packages/desktop/electron-builder.yml` 的 `publish.owner` 是 `so2liu`，这个值会被
打进 App 内的 `app-update.yml`，决定 electron-updater 去哪里查更新。
`packages/app/src/desktop/updates/desktop-updates.ts` 里的 `RELEASE_DOWNLOAD_BASE_URL`
（Rosetta 提示里的直接下载链接）同样指向 `so2liu/paseo`。

同步上游时注意：这两处很容易被上游改动覆盖回 `getpaseo`，合并后要确认还是 `so2liu`。

## 签名

macOS 的自动更新由 Squirrel.Mac 完成，它会校验新版本的代码签名，**未签名的包无法
自动更新**。所以 repo 里需要配好这些 secrets（名字沿用上游 workflow）：

| Secret                       | 用途                            |
| ---------------------------- | ------------------------------- |
| `APPLE_CERTIFICATE`          | Developer ID 证书（base64 p12） |
| `APPLE_CERTIFICATE_PASSWORD` | p12 密码                        |
| `APPLE_ID`                   | 公证用的 Apple ID               |
| `APPLE_PASSWORD`             | App 专用密码                    |
| `APPLE_TEAM_ID`              | Team ID                         |

secrets 缺失时 workflow 不会失败，而是降级成未签名构建并打一条 warning：DMG 能装
（首次打开需右键"打开"），但 App 内更新装不上，只能手动下载新 DMG。

## 被关掉的上游 workflow

fork 里这几个 workflow 的 tag 触发被移除了，只保留手动 dispatch，避免推 tag 时跑一堆
注定失败或与本 fork 无关的任务：

| Workflow              | 原因                                                   |
| --------------------- | ------------------------------------------------------ |
| `desktop-release`     | 被 `fork-macos-release` 取代，同时跑会抢同一个 release |
| `android-apk-release` | fork 不自动出 Android 包                               |
| `deploy-app`          | 部署的是上游托管的 web app                             |
| `docker`              | 推送目标 `ghcr.io/getpaseo/paseo` 我们没有写权限       |
| `release-notes-sync`  | LY tag 在 CHANGELOG 里没有对应条目                     |
