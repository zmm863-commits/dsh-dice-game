# 🎲 dsh-dice-game — 骰子大作战

经典骰子游戏合集，作为 DSH Web GUI 插件运行。侧边栏「🎲 骰子大作战」入口打开游戏面板，直接在中心列游玩。

## 玩法

- **吹牛（Liar's Dice）**：经典吹牛骰子，单人 vs AI，支持 PeerJS WebRTC 联机对战
- **猜红点 / 猜红蓝 / 猜大小 / 猜单双 / 猜顺子**：另 5 种骰子玩法

游戏为纯前端 HTML（`assets/index.html` + `peerjs.min.js` + `qrcode.min.js`），由插件宿主端通过 `/dice-game/` 路由同源提供，客户端在中心列 iframe 中加载。

## 安装

```sh
dsh plugin --profile web add dsh-dice-game
# 或本地开发：
dsh plugin --profile web add link:/root/软件项目/骰子大作战
```

重启 `dsh web`，在侧边栏点击「🎲 骰子大作战」即可开始游戏。

## 开发

```sh
npm install
npm run build      # tsdown 构建 + 复制 assets 到 lib/assets
npm run watch      # 监听构建
```

### 项目结构

```
src/
  index.ts          # 宿主端：/dice-game 静态路由 + agent 系统提示
  client/
    index.ts        # 客户端入口：挂载侧边栏入口 + 游戏面板
    controller.ts   # 面板开关状态（无框架）
    sidebar-entry.ts# 侧边栏入口（DOM 注入 + MutationObserver 自愈）
    mount.ts        # 中心列面板（标题栏 + iframe）
    styles.ts       # 面板与入口样式（--dsw-* 主题变量）
assets/             # 游戏静态资源（构建时复制到 lib/assets）
cordis.patch.yml    # profile bundle 挂载补丁
```

## 已知限制

- 联机模式依赖 PeerJS 公共信令服务器（国内网络可能需要科学上网）
- 游戏为休闲娱乐用途，不含真实货币或赌博功能

## 发布

1. `npm run build`
2. `npm publish`（发布到 npm registry）
3. 在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，把插件加入精选列表，市场（dshmarket）即自动收录

## 许可

MIT
