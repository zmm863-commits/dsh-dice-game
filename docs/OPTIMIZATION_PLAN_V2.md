# 🎲 dsh-dice-game 优化方案 v2.0（第二轮 P1+ 实施方案）

> 作者：GameDesigner｜性质：实施方案（基于 P0 落地后代码现状的修订版路线图）
> 基线：commit `43516b5`（P0 全部交付，main 同步）｜源码：assets/index.html（**5338 行**）、src/client/mount.ts（299 行）
> 上版：docs/OPTIMIZATION_PLAN.md（v1.0，163 行）｜测试：scripts/smoke-p0.mjs（**44 项断言当前全绿 ✅**）
> 硬约束：联机 MP 保持 `MP_DISABLED=true` 不动；opaque iframe 无 localStorage；新文案一律中英双语（I18N.t + data-i18n）

---

## 〇、P0 复检：六项交付定位 + 基线新发现

### 0.1 P0 六项完成度（源码内定位）

| # | P0 项 | 代码位置 | 状态 |
|---|---|---|---|
| ① | postMessage 存储桥 DICE-SAVE v1 | index.html:4642 DiceStore（三级降级 ls→pm→mem）；mount.ts:67-178（宿主侧桥 installDiceStorageBridge 于 130）（引用鉴权+白名单+64KB 截断） | ✅ 完成，smoke [F][G] 覆盖 |
| ② | WebAudio 音效三件套 | index.html:4807 SFX（roll/open/win/lose）+ 首次手势 resume | ✅ 完成 |
| ③ | Confetti＋震屏三档 | index.html:4886 FX + CSS 272-311（.shake-s/m/l、.confetti-*） | ✅ 完成 |
| ④ | 吹牛 AI 二项分布三档 | index.html:5148 LIAR_AI_LEVELS + 5185 aiDecide（theta/bluff/noise/delay/freqFix） | ✅ 完成（**仅吹牛**） |
| ⑤ | 连胜称号＋连败保护 | index.html:4966 TITLE_LADDER + 4986 registerWin / 4998 registerLoss | ⚠️ 见 0.2-② |
| ⑥ | 六玩法赔付表 | index.html:5037 STAKE + PAYOUT_TABLE + 5062 onSettle（六玩法统一结算钩子） | ✅ 完成，smoke [B][E] 覆盖 |

### 0.2 基线复检关键发现（按严重度排序，P1 必须消化）

1. 🔴 **线上部署滞后于 git**：/dsh/profiles/web/node_modules/dsh-dice-game/lib/ 下 index.html **不含** DiceStore/PAYOUT_TABLE/SFX，client.js **不含** installDiceStorageBridge/DICE-SAVE —— 现网跑的还是 P0 之前的 build（Aug 19），git 仓 lib/ 是 Aug 24 的 P0 版。**P2 任何改动若直接基于部署版验证，等于在错误基线上迭代。**
2. 🔴 **连败保护接线断裂**：全文件检索确认 `loseProtectActive` 只被初始化为 false（4976）并在 registerWin 里复位（4990），**没有任何代码把 `loseProtectArmed`（3 连败武装，5001-5003）置为 `loseProtectActive=true`**。结果：降档从未生效、保护局首胜 +2 从未触发、toast「连败保护」是空头承诺。smoke-p0 [C] 只验证了手工置 true 后的机制，未覆盖接线。
3. 🟡 **非吹牛五玩法 AI 仍是裸阈值＋随机噪声**：computerRedTurn(2915)、aiBigSmallDecide(3151)、aiOddEvenDecide(3302)、aiRedBlueDecide(3630)、aiStraightDecide(3498) 全部是「期望±2、随机开盅」的 v1.0 病灶，P0 只升级了吹牛；且五玩法的思考延迟是**写死 800/1200ms**，无难度联动。
4. 🟡 **结算细节 i18n 缺漏**：`吹牛被识破！``叫点成立！``你的骰子：``电脑骰子：``你的红点：``电脑红点：``已有的骰子：``缺失的数字：``万能1使用：``结果：顺子成立/不成立``😅 电脑赢了` 等约 15 处硬编码中文（2995-3879 区间），EN 模式下结算弹窗中英混杂——违反 P0 双语承诺。
5. 🟡 **单双连中链跨模式残留**：`oddevenWinChain` 只在败局清零（5135），switchMode(2431) 与 resetGame(2504) 均不重置——从单双切到吹牛再切回，连中链延续，赔付曲线失真。
6. 🟡 **任务系统占位未实现**：dice_tasks 键已进 DiceStore.KEYS 白名单（4643）与宿主侧 DICE_SAVE_KEYS，但游戏内无任何读写。

---

## 一、优先级总览

| 阶段 | 内容 | 项数 | 依赖 |
|---|---|---|---|
| **P1（本轮）** | 部署基线校正、连败保护接线、五玩法 AI 升级、每日任务、结算弹窗重构+i18n 补漏、设置抽屉、生涯面板、窄屏适配 | 8 | 全部纯前端，互不阻塞；P1-1 先行 |
| **P2（后续）** | 新玩法「一掷定音」、骰子皮肤商店、大师 AI 全玩法频率修正、战绩分享卡片、触觉反馈、蒙特卡洛 RTP 校验 | 6 | P1-3/P1-7 产出 |
| **P3（远期）** | 赛季称号、成就徽章墙、MP 解禁清单（保持冻结）、无障碍、AI 观战回放 | 5 | P2 经济闭环 |

---

## 二、P1 实施方案（本轮，8 项）

### P1-1 部署基线校正＋回归门禁 —— 难度 S

- **问题**：见 0.2-①。现网插件是 P0 前版本，玩家体验不到任何 P0 成果（无音效/特效/赔付/持久化）。
- **改动点**（无代码，流程）：
  1. `PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /usr/local/bin/npm run build`（tsdown → build.mjs → copy-assets.mjs 产出 lib/）；
  2. 跑 `node scripts/smoke-p0.mjs` 全绿后 `cp -r lib/* /dsh/profiles/web/node_modules/dsh-dice-game/lib/`；
  3. 部署后核验：部署版 index.html 含 `DiceStore`、client.js 含 `installDiceStorageBridge`。
- **预期效果**：现网回到与 git 一致的正确基线，P1 后续项的所有验证才可信。
- **验收标准**：3080 页面刷新后语言/战绩/静音保持；smoke-p0 44 项全绿；部署版 grep 三处关键符号命中。
- **风险**：无。若 smoke 出现红项，先修基线再进 P1-2。

### P1-2 连败保护接线修复 —— 难度 S

- **问题**：见 0.2-②。空头承诺直接伤害玩家信任（设计师红线：诚实设计）。
- **改动点**（index.html）：
  1. 末尾 P0 包装 newRound（5330-5337）内新增：`if (loseProtectArmed && !loseProtectActive) { loseProtectActive = true; showToast('🛡️ ' + I18N.t('保护局：AI 已降档，赢下恢复'), 3200); }`——武装在第 3 败结算后，下一次开局生效；
  2. updateStreakChip（5014-5023）补分支：winStreak===0 && loseProtectArmed 时芯片显示「🛡️ 保护待命」，让机制可见；
  3. registerWin（4986）已有复位逻辑，保持。
- **预期效果**：3 连败后下一局 AI 降半档（effectiveLiarLevel 全玩法生效，见 P1-3）、胜后连胜 +2、全程有文案明示。
- **验收标准**：smoke-p2 新增断言「registerLoss×3 → 调 newRound() → loseProtectActive===true 且 toast 文案存在」；手工 3 连败后第 4 局连胜计数 +2。
- **注意**：此修复必须与 P1-3 一起验收，因为降档语义要覆盖全部六玩法（当前 effectiveLiarLevel 只被吹牛引用，5158）。

### P1-3 非吹牛五玩法 AI 二项分布升级 —— 难度 L（本轮最大工程）

- **问题**：见 0.2-③。六玩法里五玩法仍是「裸阈值＋噪声」，与吹牛 AI 体感断层；三档难度选择器只对吹牛生效，用户会以为难度按钮是坏的。
- **改动点**（index.html）：
  1. 新增统一难度助手 `function aiTier() { return LIAR_AI_LEVELS[effectiveLiarLevel()]; }` 与 `function aiThinkDelay() { … tier.delay 随机 }`，替换五处写死延迟（1200/800ms：newRound 2550-2564、computerRedBlueTurn 3622、computerBigSmallTurn 3134 区、computerOddEvenTurn 3285 区、computerStraightTurn 3479 区）；
  2. **猜红点**（computerRedTurn 2915）：对手 5 骰红点分值分布用卷积精确建模——单骰分值 0(4/6)/1(1/6)/4(1/6)，5 骰总分布可枚举 6^5=7776 或 DP；`pTrue = P(对手红分 ≥ bid − myTotal)`，低于 tier.theta 判开盅，加码量 = myTotal + E(对手) + aiNoise(tier)；
  3. **猜红蓝/猜大小/猜单双**（3630/3151/3302）：双维二项——`pRed = binomTail(5, p_red, bidRed − myRed)`、`pBlue = binomTail(5, p_blue, bidBlue − myBlue)`，联合判据取 `min(pRed, pBlue)`（保守，符合「任一维不满足即吹」的规则）；加码沿自己最可辩护维度 +1，偶发诈唬率 = tier.bluff；
  4. **猜顺子**（aiStraightDecide 3498）：对叫点长度 L 的缺失数字集合，用枚举计算「对手 5 骰能补上全部缺失」的概率（①万能＋具体数字），同样过 theta 阈值；`evaluateMaxStraight` 保留作为开局估值；
  5. 三档阈值初值沿用吹牛档位（rookie 0.28 / normal 0.42 / master 0.55），诈唬率/噪声/延迟同轴，标注 [PLACEHOLDER] 待 P2-6 蒙特卡洛回收。
- **预期效果**：六玩法难度统一可调；大师档全玩法自测胜率 <45%（验收锚点 [PLACEHOLDER]）；必输局面稳定开盅、低风险局面不再「随机弃权」，AI 行为从「噪音」变「有信念」。
- **验收标准**：smoke-p2 断言六玩法三档延迟配置存在、每玩法「必吹局面」返回 challenge、三档体感差异由人工试玩表记录（每档 20 局，普通档胜率≈50%±10%）；连败保护降档在任意玩法生效。
- **实现提示**：red 的卷积分布与 straight 的补缺概率可写成纯函数（如 `redOppDist()`、`straightCoverProb(missSet)`），便于 smoke 直接断言数值。

### P1-4 每日任务系统（持久化版，兑现 v1.0 §三）—— 难度 M

- **问题**：见 0.2-⑥。v1.0 承诺「存储桥落地后升级为每日刷新」，现存储桥已就绪，任务系统缺位；当前留存完全靠连胜称号单点。
- **改动点**（index.html）：
  1. 新增 `const TASKS = { … }` 运行时（P0 区段后、初始化前）：任务池 8 条（赢 2 场 / 单局彩金 ≥200 / 任意模式 3 连胜 / 吹牛成功开盅 1 次 / 围骰押中 / 全红头奖 / 单双连中 3 次 / 六玩法各胜 1 场），每日取 3 条；`dice_tasks` 结构 `{date:'YYYY-MM-DD', list:[{id,target,progress,done}], rewardLog:[]}`，日切键用 **Asia/Shanghai（UTC+8）** 本地日期；
  2. 进度挂点全部收敛到 onSettle（5062）与各 reveal 判定处：胜负/彩金/开盅/围骰/连中/模式维度；完成时 toast＋FX.confetti＋骰币入账（`stats.coins`），奖励 50/100/300 三档；
  3. **防刷红线**：每日奖励封顶 3 条任务全清 = 至多 450 骰币/日（设计原则：娱乐正 EV 可以，无限刷分回路禁止）；
  4. UI：center-panel（1516-1521 区）下加任务胶囊条（3 枚小徽章，完成打勾，点击展开明细），双语。
- **预期效果**：日活动机从「赢了开心」升级为「今天清完 3 单」；任务进度跨刷新/跨日持久化（复用 DiceStore），是现有骰币经济的第一颗消费/留存储蓄。
- **验收标准**：完成任一任务 → 骰币到账且刷新后保持；修改系统日期跨日后刷新任务轮换；mem 降级下不报错；三条任务全部完成的次日不重复发奖。
- **依赖**：P1-1 之后（需要线上正确基线验证持久化）。

### P1-5 结算弹窗信息架构重构＋i18n 补漏 —— 难度 M

- **问题**：见 0.2-④。六处 reveal 的 detail 是纯文本 `\n` 堆叠（3842-3900、2998、3213、3364、3554、3686），胜负关键信息淹没；EN 模式中英混杂。
- **改动点**（index.html）：
  1. 新增 `buildResultHTML(winner, rows, payoutLine)` 统一渲染：胜负横幅（胜=绿/负=红）、「叫点 vs 实际」对照行、骰子明细行、赔付行（金色高亮）；modalDetail（1792）允许 HTML（数据全部来自内部变量，无注入面）；
  2. 六处 reveal 的 detail 拼接改为结构化 rows 传入；`modalTitle` 双色（`.modal-title.win/.lose`，CSS 815-880 区）；
  3. **i18n 补漏**：0.2-④ 列出的 ~15 个硬编码词条全部进 I18N.dict zh/en（含 `😅 电脑赢了`、`等待叫点...` 已有词条复用）；
  4. modalDice（1793）骰子区加 300ms 翻转入场动画（复用 .dice 现样式加 keyframes）。
- **预期效果**：一眼看懂「叫了多少、实际多少、赢了×几」；EN 玩家结算体验与 ZH 对等；为 P1-7 生涯面板与 P2-4 分享卡片铺路（复用同一渲染函数）。
- **验收标准**：EN 模式六玩法结算弹窗无中文残留；375px 宽不溢出；smoke-p2 断言硬编码中文词条在源码中仅以 i18n 字典形式存在。

### P1-6 统一设置抽屉（收敛三个漂浮按钮）—— 难度 M

- **问题**：右上角堆叠 语言按钮（top:14）/特效（top:52）/音效（top:86）三个 fixed 按钮（2279-2288、5254-5284），视觉杂乱、与顶部标题重叠、无分组。
- **改动点**（index.html）：
  1. 新增 `#settingsPanel` 右滑抽屉 + 顶栏 ⚙️ 按钮；内容：语言切换 / 音效开关 / 特效开关 / AI 难度（三档，全玩法生效）/ 单双连中链重置 / 清空生涯数据（二次确认）；
  2. 移除 injectLangButton(2279) 与 injectFxButtons(5254) 的 fixed 按钮注入逻辑，状态读写（DiceStore keys）迁入抽屉；`data-i18n-title` 的 tooltip 文案随迁；
  3. 抽屉本体用现有 modal-overlay 模式（1788 区）加右侧滑入动画，CSS 新增 ~30 行。
- **预期效果**：设置入口单点化、可发现性提升；视觉干扰下降。
- **验收标准**：六项设置在抽屉内可操作且持久化（刷新保持）；旧漂浮按钮不再注入；375px 宽度抽屉不溢出。
- **依赖**：与 P1-3 的难度全局化联动验收。

### P1-7 生涯战绩面板 —— 难度 M

- **问题**：现在只有 careerLine 一行字（5025-5031），六玩法各自战绩不可见，硬币只有累计数没有流向感。
- **改动点**（index.html）：
  1. `dice_stats` 扩展 `perMode:{liar:{w,l},red:{w,l},…}` 与 `payoutTotal`，在 onSettle（5062）winner 分支累加（败局同时累加，口径与现有 wins/losses 一致）；
  2. 新增 `#statsOverlay` 面板（顶部 🏆 按钮）：总场次/总胜率/累计彩金/最长连胜🔥/当前称号 + 六玩法分战绩（横向条形，复用 streak-chip 视觉语言）+ 称号墙（TITLE_LADDER 四级）；
  3. 与 P1-5 共用双语词条；历史数据无 perMode 时优雅回退（旧存档只显示汇总）。
- **预期效果**：玩家看到「我在哪个玩法强」→ 产生回访动机与跨玩法探索（设计动因：胜率低的玩法正是留存钩子）。
- **验收标准**：六玩法各打 2 局后 perMode 计数与汇总一致；EN 双语；旧存档（无 perMode）打开不报错。
- **依赖**：P1-5 的 i18n 词条体系。

### P1-8 窄屏与触控适配 —— 难度 S-M

- **问题**：响应式只有 `@media (max-width:380px)` 一档（1353-1367）；控制面板六种布局在 375px 宽度下拥挤，红点模式 11 键（0-10）依赖 30px 小按钮（547-553），触控目标 <40px。
- **改动点**（index.html CSS）：
  1. 断点扩充为 320/380/480 三档；control-panel（479-489）加 `max-height:46vh; overflow-y:auto`，窄屏 num-group 换行；
  2. 触控目标：普通按钮 min 40×40（原 38px 微调），红点 11 键窄屏改为 2 行（6+5）布局而非缩小；
  3. mode-selector（44-80 区）窄屏允许横向滚动。
- **预期效果**：iPhone SE（375px）与折叠屏外屏（320px）六玩法零横向溢出、误触率下降。
- **验收标准**：320/375/480 三档视口六玩法控制面板无横向滚动条；触控区 ≥40px；smoke-p2 不做视觉断言（人工 checklist）。

---

## 三、P2 后续优化（下一轮，提前定方向）

| # | 项 | 来源 | 落点 | 难度 |
|---|---|---|---|---|
| P2-1 | 新玩法「一掷定音」 | v1.0 §七-3（3 骰 2 次重掷按牌型计分） | index.html 新增第 7 面板，复用骰子渲染/结算弹窗 | M |
| P2-2 | 骰子皮肤商店 | v1.0 §九 P2 | 新增 dice_skin 键（白名单需同步 host 侧 DICE_SAVE_KEYS 与 DiceStore.KEYS）；骰面主题 ×6，金币购买（消费 P1-4 产出），追加「宿主桥新键」部署注意 | M |
| P2-3 | 大师 AI 全玩法频率修正 | v1.0 §二.2.3 大师档 | 把 aiFreqTrack（5169）模式推广到五玩法：统计玩家各玩法叫点偏差修正 theta | M |
| P2-4 | 战绩分享卡片 | 社交维度新增 | canvas 绘制战绩图（胜率/称号/彩金），同 P1-5 渲染函数；新玩法内无真钱，注意话术 | S |
| P2-5 | 触觉反馈分级 | UX 新增 | navigator.vibrate：胜 40ms/彩金 80ms/败 20ms，跟随 FX.enabled 开关，写入 dice_fx 同键 | S |
| P2-6 | 蒙特卡洛 RTP 校验 | v1.0 §一 [PLACEHOLDER] 回收 | node 脚本模拟 10 万局六玩法，校验赔付表实际 RTP 与宣称一致（±3%），修订 STAKE/倍数 | M |

## 四、P3 远期（方向备忘，本轮不展开）

- **P3-1 赛季制**：7 天一轮本地赛季，赛季称号+赛季结算动画（依赖 P1-7 数据）；
- **P3-2 成就徽章墙**：12 枚徽章（首胜/首金/全红头奖/10 连胜/六玩法全通/累计 1000 骰币…），dice_achieve 键（新增白名单键）；
- **P3-3 MP 解禁前置清单**：v1.0 §六 六项清单**保持冻结**，MP_DISABLED=true 不动；唯一备忘——若未来解禁，scoreboard 的 innerHTML 直写（4156 区）已随 P1-5 迁入 i18n 体系；
- **P3-4 无障碍**：结算弹窗加 ARIA live、键盘可达性（Tab 顺序）；
- **P3-5 AI 观战/局回放**：记录叫点序列回放，教学向。

---

## 五、回归与验收体系

1. **smoke-p2.mjs 扩展**（新增 ~25 项断言，保持 smoke-p0 全绿为前提）：
   - [C2] 连败保护接线：registerLoss×3 → newRound → loseProtectActive===true；
   - [D2] 五玩法 AI：每玩法三档延迟配置存在、必吹局面判 challenge、red 卷积分布数值锚点（如 P(对手红分≥0)=1）；
   - [H] 任务系统：任务完成→coins 到账、日切换单、奖励封顶 450/日；
   - [I] i18n：六玩法结算文案 EN 无中文残留（扫描 detail 生成路径）；
   - [J] 设置抽屉/生涯面板元素就位。
2. **人工验收表**（每项附 checklist）：375px 视口、EN/ZH 双语言、刷新持久化、隐私模式降级。
3. **红线复述**：所有新数值标 [PLACEHOLDER] 直到 P2-6 回收；每日任务奖励封顶防刷；不引入任何真实货币语义。

## 六、风险与依赖

- **P1-3 是唯一 L 级项**：建议单独一个改动 commit（`feat: 五玩法 AI 二项分布升级`），其余 P1 项可并行小 commit；五玩法 AI 共用 effectiveLiarLevel 后，P1-2 的降档语义自动覆盖全玩法，二者同 PR 验收。
- **P1-1 必须最先执行**：现网基线错误会污染一切人工验收（尤其 P1-4 的持久化验证）。
- **新增持久化键**（P2-2 皮肤、P3-2 成就）需**同时**改三处：DiceStore.KEYS（index.html:4643）、宿主侧 DICE_SAVE_KEYS（mount.ts:66-76）、smoke-p0 [G] 白名单断言——已列入对应项验收。
- 所有 UI 文案新词条：zh/en 双语一次写全，避免 EN 回退中文（0.2-④ 教训）。

— 完 —（v2.0 待实施；P1 八项为下一 commit 范围）
