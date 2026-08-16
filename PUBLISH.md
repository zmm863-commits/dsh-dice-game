# 📦 发布指南 — 上架 DSH 插件市场

把 `dsh-dice-game` 发布到 [dsh-market](https://github.com/dsh-market/dsh-market) 插件市场（所有用户可一键安装）共两步：**发布 npm 包** + **在 awesome-dsh-plugin 提 PR**。

## 第 1 步：发布 npm 包

市场安装走 npm tarball，所以插件必须先发布到 npm。

```sh
# 1. 确认构建产物齐全
npm run build && npm test

# 2. 登录 npm（需要 npm 账号）
npm login

# 3. 发布
npm publish
```

> 当前包名为 `dsh-dice-game`（未加 scope）。若已被占用，请改为 `@你的用户名/dsh-dice-game` 并同步修改 `package.json` 的 `name`、`cordis.patch.yml` 的 `name` 与 profile 依赖。

### 发布前检查清单

- [x] `package.json` 的 `repository` 字段已填写（市场 registry 会校验 repository 指回同一仓库，防止冒名）
- [x] `files` 包含 `lib`（内含 `lib/assets/` 三个游戏文件）与 `cordis.patch.yml`
- [x] `dsh.bundle.patch` / `dsh.client` manifest 正确
- [x] `npm pack --dry-run` 确认包体积合理（游戏 assets ~237KB）

```sh
npm pack --dry-run   # 查看实际会发布哪些文件
```

## 第 2 步：在 awesome-dsh-plugin 提 PR

插件列表来自 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。提 PR 在列表里加一行，站点（awesome-dsh-plugin.com）与 dsh-market 通常一天内自动收录。

1. Fork 仓库并克隆
2. 同时修改两个列表文件（中文 + 英文），在 **🎮 娱乐** 分类按字母序插入一行：

**README.zh.md**：
```markdown
- [zmm863-commits/dsh-dice-game](https://github.com/zmm863-commits/dsh-dice-game) — 骰子大作战：经典骰子游戏合集（吹牛/猜红点/猜红蓝/猜大小/猜单双/猜顺子），支持 AI 对战与 PeerJS 联机。
```

**README.md**（英文）：
```markdown
- [zmm863-commits/dsh-dice-game](https://github.com/zmm863-commits/dsh-dice-game) — Dice Battle: a classic dice game collection (Liar's Dice / Red / Red-Blue / Big-Small / Odd-Even / Straight) with AI and PeerJS online play.
```

3. 提交 PR，标题示例：`add: dsh-dice-game (dice game collection)`

### 上架后

- 在 README 挂收录徽章：

```markdown
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
```

- 用户可通过 `dsh plugin --profile web add dsh-dice-game` 或 dsh-market 设置页一键安装。

## 本机安装（开发验证）

```sh
# 本地链接安装（开发热迭代）
dsh plugin --profile web add link:/root/软件项目/骰子大作战
# 或手动：symlink 到 profile node_modules + 在 profile package.json 的
# dsh.profile.bundles 与 dependencies 里登记（本项目已按此方式装好）
```

## 常见问题

- **`dsh plugin add` 报 pnpm 404**：profile 里有未发布的依赖（如私有包）会导致整树解析失败，改用 symlink + bundles 方式（见上）。
- **改代码后要重启 dsh web 吗**：宿主端（路由/系统提示）改动需重启；客户端改动刷新页面即可（HMR 在 dev:web 下自动生效）。
- **联机模式连不上**：PeerJS 公共信令服务器在国内可能需科学上网，属游戏本身限制，与插件无关。
