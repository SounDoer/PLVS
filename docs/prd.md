# PLVS — Product Requirements (PRD)

## Abstract (English)

PLVS is a **local, read-only real-time audio meter** for **sound designers and mix engineers**: **Peak/level**, **LUFS loudness**, **FFT spectrum (RTA-style)**, **spectrogram**, **vectorscope/correlation**, and **waveform**, delivered as a **Tauri desktop app** for **Windows and macOS** with **equal product intent** (implementation constraints are documented separately). PLVS centers on **live monitoring** but also supports an **offline file-analysis mode** for local audio files (still read-only). The app **does not process**, **route**, or **modify** audio; it **does not** ship as a plug-in, **does not** target Linux, and **does not** pursue storefront distribution in the near term. **Loudness** is based on **ITU-R BS.1770** measurement practice with **EBU R128** production/gating usage; **spectrum** is an **FFT-based RTA aligned with common DAW practice** (per-band power integrates FFT bins using **fractional Hz overlap** between band edges and each bin’s frequency tile; vertical scale is **in-band level in the dBFS domain**—same digital full-scale reference as peak meters but a different detector definition; see `docs/architecture.md`), not IEC 61260 filter-bank metrology. This PRD states **product intent and boundaries only**; the current feature inventory lives in `README.md` and `CHANGELOG.md`. **English is the default UI language**; **i18n** is a future option. **Privacy**: audio stays on device; **no default telemetry**; update checks are automatic; Feedback diagnostics and crash reports are transmitted only after an explicit user action; audio samples are never attached; **no silent failure** for user-visible metering health. **Legacy browser builds** are **not maintained** and **may be removed**. **Distribution** is via **GitHub Releases**; **in-app update checking** is delivered and committed, while **code signing and Apple notarization** remain **optional future milestones**.

---

## 1. 文档结构与读者

本文档只写 **产品意志**：目标用户、承诺、非目标、体验原则，以及每条边界背后的理由。

本文 **不清点当前能力**。当前有哪些面板、哪个平台支持什么、这一版交付了什么，属于会随每次发布变化的事实，写在 **`README.md`** 与 **`CHANGELOG.md`**；**技术栈、模块分层、IPC 细节**以 **`architecture.md`** 为准。这样划分是为了让本文可以长期不改，一旦它开始跟踪现状，就一定会过期。

---

## 2. 问题陈述（用户视角）

声音设计/混音工作需要 **长时间开着**、 **一眼能读** 的表头：电平是否危险、响度是否在合理区间、立体声是否异常、频谱是否明显失衡。  
工具必须 **只做监测**、 **不改变声音链路**；应优先支持 **系统正在播放的声音**（Windows/macOS 原生路径），并支持 **物理输入**作为同一类「信号源」选择题。  
分发上应诚实面对 **免签名安装**、 **Gatekeeper/SmartScreen** 等现实，而不是用「看起来正规」掩盖实际上下文。

---

## 3. 解决方案概述（用户视角）

提供一个 **独立桌面应用**：用户选择 **输入源（含 Automatic）** 后开始监测；在同一界面中同时查看 **多块表头**（当前清单见 `README.md`）。  
数据 **`默认不上传`**；历史数据以 **会话级**为主；导出（若出现）只服务 **当前会话**，**重开应用不自动恢复**历史监测数据。

---

## 4. 目标用户与使用场景

- **主画像**：**声音设计 / 混音师** —— 会话型、长时间常驻。
- **面板重要度**：各表头对用户 **同等日常重要**；在资源或排期紧张时，**优先打磨 Loudness 与 Spectrum**。
- **典型场景**：戴耳机/音箱工作，同时播放 DAW/系统音频；需要 **快速确认** 峰值与响度趋势、必要时扫一眼矢量与频谱。

---

## 5. 产品承诺（愿）

### 5.1 能力与边界

- **只做监测**：不加入 EQ/限幅/重路由等 **音频处理**能力。
- **形态**：**独立应用**；**不做** VST/AU/AAX 等插件形态。
- **平台**：**Windows 与 macOS 平等叙事**；OS 差异与最低版本如实写在 `README.md`，不在承诺层面抹平。
- **信号源**：**统一信号源下拉（A）** —— 同一选择器覆盖 **系统输出（loopback / tap）** 与 **物理输入**；包含 **Automatic / 默认输出**语义（用户选的是 **信号**，不是底层 API 名）。
- **表头**：多块表头 **同屏**（清单见 `README.md`）；默认 **英文 UI**；**主题**默认 **跟随系统**，保留 **Light/Dark**，并已支持 **自定义主题与主题编辑器**。
- **隐私**：音频与计量数据 **默认不外传**；**默认无遥测**；**更新检查**是唯一的自动对外请求（见 5.3）；反馈诊断与崩溃报告 **仅在用户明确选择发送后**才传出，且 **永不附带音频样本**；未来若增加导出/诊断，同样必须 **明示、可选**。
- **伦理底线**：**不得静默失败**（见 5.4）；并避免用户误以为已退出却仍在采集（与 5.7 一致）。
- **过载**：当系统可能 **丢数据/背压**时，必须 **用户可见降级提示**（例如 **状态栏**），不得假装仍然精确。
- **启动**：**默认不自动 START（A）** —— 需用户明确开始监测；避免后台惊吓与资源占用争议。
- **许可与归属**：分发与贡献遵循仓库许可证；第三方素材的归属按仓库 **README / NOTICE** 等维护（见第 10 节）。

### 5.2 计量声明（期望管理）

- **响度**：测量内核遵循 **ITU-R BS.1770**；制作实践与门控等遵循 **EBU R128** 体系表述（版本与实现细节见 `architecture.md`）。本产品 **不声称**法定/认证计量或第三方平台「背书」。
- **用户规则**：用户可在 **同一套测量结果**上定义 **参考线/区间/规则**，用于自己的监测与判断；产品不承诺持续扩充按平台命名的预设集合。
- **频谱**：采用 **FFT 型 RTA 的常见工程实践**（带内能量按 **Hz 连续边界** 与各 FFT bin 的**分数重叠**聚合，而非整档扣整数 bin；**STFT** 固定 **hop=N/4**、**4 帧**带内线性功率非相干平均后再转 dB）；纵轴为 **dBFS 域**带内谱功率（与 Peak 的采样峰值 dBFS **同参考域、不同定义**）；**不声称** IEC 61260 滤波器组计量路径；与响度 **不可横向等同**。第一版对外承诺 **Spectrum 为固定口径的参考视图（B）**，实现口径见 **`docs/architecture.md`** 的 DSP 层说明。
- **多声道**
  - **Loudness**：标准布局走 **正统多声道积分（L1）**，权重依据 **ITU-R BS.1770-5 Annex 3 Table 5**（侧环绕 ±90°/±110° 为 +1.5 dB，后环绕 ±135° 与其余位置为 0 dB，LFE 不计入）；当前范围覆盖 **mono / stereo / LCR / quad / 5.0 / 5.1 / 7.0 / 7.1 / 5.1.2 / 5.1.4 / 7.1.2 / 7.1.4 / 9.1.6**，声道顺序为 **WAVE / ffmpeg 原生顺序**。
  - **True Peak**：**True Peak Max 覆盖全部声道**；True Peak L/R 读数仅表示 Ch1/Ch2。
  - **布局策略**：**Z + Y** —— 能可靠识别标准布局则走 L1；识别失败则 **降级为 Ch1/Ch2 立体声响度**，并在 Loudness、Stats、Dock Loudness 与文件摘要中显示 **`Ch 1–2` 标记**；退化读数必须可读、不可装成「环绕正统读数」。
  - **布局交互**：最多 8 声道时可按声道数自动识别；更高声道数绝不只凭数量猜测。未知布局同时显示 **`Ch 1–2` 标记**与 footer 提示。手动布局可在 Settings 的 **Channels · Layout**、Agent Control 的 `settings.channelLabels.layout`，以及内部 CLI 的 `--layout` 中选择。
  - **Level Meter**：多通道时 **逐通道呈现**。
  - **Spectrum（>2ch）**：用户可在面板控制中选择标准声道对或单声道查看。
  - **Vectorscope**：始终 **一对通道**；默认 **Front L/R**（在映射成立时），可在面板控制中切换声道对。

### 5.3 分发与更新（诚实叙事 + 路线图）

- **分发**：以 **GitHub Releases** 获取构建物。
- **应用内更新检查**：**已交付并作为正式承诺** —— 应用会检查新版本并提示用户；这是产品默认的唯一自动对外请求，隐私口径见 5.1。
- **未来可选里程碑**：**代码签名 / Apple 公证** —— **不承诺日期**；在此之前 **SmartScreen / Gatekeeper** 的首次运行摩擦在 README 与 Release 说明中如实交代。

### 5.4 运行时故障语义

- **底线（C）**：**禁止静默失败**；必须让用户知道「现在不可信/已停止/需处理」。
- **自愈 vs 保守停机**：不在 PRD 强行二选一；由 issue 分场景闭环（与 **过载可见提示（A）**一致）。

### 5.5 会话、历史与导出

- **历史数据默认会话级**：进程重启 **不承诺**恢复历史曲线（**A**）。
- **导出**：若存在，仅服务 **当前会话**；**关闭重开不恢复**导出上下文。

### 5.6 多实例

- **不专项承诺多实例矩阵（A）**；系统允许多开则不主动禁止，但不对「多进程 × 多设备」做全覆盖保证。

### 5.7 系统托盘与后台采集

- **已交付（原 v1 不承诺）**：系统托盘已实现，含主题感知托盘图标与 **关闭行为设置**（关到托盘 / 退出）、**开机自启**选项。

### 5.8 快捷键

- **已交付（原 v1 不强制）**：应用内快捷键体系已实现，并支持 **可自定义的全局 Clear 快捷键**（Settings 内可录制组合键）。

### 5.9 诊断

- **最小策略（B）**：界面至少提供 **版本/构建信息**便于排障；更重的「一键复制诊断包」暂不作为承诺。

### 5.10 国际化

- **v1 英文界面**；未来 **i18n** 作为可选里程碑（**B**），不承诺时间与覆盖语言。

### 5.11 无障碍

- **近期不作为验收主线**（若后续提升，将单独立项）。

---

## 6. 明确不做（非目标）

以下内容 **除非未来修订 PRD**，否则 **不纳入实施承诺**：

1. ~~**离线音频文件分析**~~ —— **已撤销（2026-06）**：File 模式已交付，支持本地音频文件离线分析；仍为 read-only、不处理音频。实时监测仍是核心。
2. **真实音频处理**（EQ/效果链/重路由导致“声音从哪输出”失控）。
3. **插件形态**（VST/AU/AAX）。
4. **应用商店上架**（短中期）。
5. **Linux 桌面端**。
6. **同一应用内多路同时监测 / A-B 对比**（短中期）。
7. **通用自定义用户偏好框架**（短中期以 **明确清单式持久化**为主，而非开放插件化偏好系统）。
8. **面向普通用户的通用数据导出**（CSV / 历史导出入口）。Agent Control 的截图与录制服务于自动化，不是通用导出、通用录音或桌面捕获工作流。
9. **对象 / 场景音频**（ADM BWF、Dolby Atmos 对象、Ambisonics）。BS.1770-5 Annex 4 要求先渲染到 BS.2051 扬声器布局再测量，需要内置渲染器，单独评估。
10. **一键诊断包导出**（见 5.9）与 **无障碍专项**（见 5.11）：均非短期主线。
11. **MCP 集成**：Agent Control 以 `plvs-cli` 为唯一的自动化入口，是否另提供 MCP server 留待单独的产品决定。

**Legacy 浏览器版**：**不再维护功能**；**可能下线仓库分支/托管**；详见第 9 节。

---

## 7. 用户故事（编号）

1. 作为 **混音师**，我希望 **启动应用后选择信号源再开始监测**，以便 **避免意外开始采集**。
2. 作为 **混音师**，我希望 **在同一下拉中选择麦克风或系统回放**，以便 **不需要理解底层 API**。
3. 作为 **混音师**，我希望 **使用 Automatic 绑定到默认输出/系统口径的默认源**，以便 **减少首次配置成本**。
4. 作为 **混音师**，我希望 **同时看到 Level Meter/Loudness/Spectrum/Vectorscope 等表头**，以便 **一眼完成多维判断**。
5. 作为 **混音师**，我希望 **响度相关读数可信且解释清楚**（含 integrated 不足时的语义），以便 **减少误判**。
6. 作为 **混音师**，我希望 **频谱是稳定一致的参考视图**，以便 **跨天对比时口径不被 UI 选项搅乱**（首版固定口径）。
7. 作为 **混音师**，我希望 **在系统过载/丢数据时看到提示**，以便 **不会迷信此刻读数**。
8. 作为 **混音师**，我希望 **采集失败时看到原因而不是假数据**，以便 **快速回到可信状态**。
9. 作为 **混音师**，我希望 **关闭应用即停止监测叙事成立**，以便 **不担心后台偷采**。
10. 作为 **混音师**，我希望 **我的音频默认不被上传**，以便 **安心用于未发布作品**。
11. 作为 **Windows 用户**，我希望 **无需虚拟声卡即可听系统播放并测量**。
12. 作为 **macOS 用户**，我希望 **在支持的系统版本上使用原生 tap 路径**，以便 **避免旧网页版那套路由**。
13. 作为 **下载用户**，我希望 **知道 SmartScreen/Gatekeeper 的处理方式**，以便 **顺利首次运行**。
14. 作为 **混音师**，我希望 **Loudness Profile 是会话级、自定义优先的规则集**：首次配置提供一个 **按实际参数命名、可编辑、可删除**的示例，其余由用户自建；它驱动 **Loudness 参考线、Stats 数值配色与 Level Meter 的 TP Max 标记**，不提供或暗示 **平台、广播或法规认证预设**，而响度测量仍遵循 **ITU-R BS.1770**。
15. 作为 **环绕内容用户**，我希望 **在识别布局时看到正统多声道响度**，以便 **不与立体声糊弄语义**。
16. 作为 **环绕内容用户**，我希望 **在布局未知时被明确提示并降级**，以便 **知道此刻不是“认证环绕读数”**。
17. 作为 **贡献者**，我希望 **许可证与第三方归属清晰**，以便 **合规分发与再分发**。
18. 作为 **开发者**，我希望 **PRD 与架构文档分工明确**：产品意图在这里、协议与分层在架构文档。

---

## 8. 实现决策（不含具体文件路径）

- **产品形态**：桌面 **Tauri**；前端 **Web 技术 UI**，后端 **Rust** 采集与 DSP；DSP 与指标计算 **不下放到前端**。
- **通信**：控制走 **command**；高频帧走 **Channel**；低频走 **Event**；细节以架构文档为准。
- **历史 ring**：以 **Rust 侧会话内缓冲**为主叙事（与架构一致）；前端为展示与交互消费端。
- **多声道**：按声道数自动识别最多 8 声道的标准布局；手动布局覆盖 mono 至 9.1.6，权重依据 BS.1770-5；未知布局降级 Ch1/Ch2 并显示标记与 footer 提示；True Peak Max 覆盖全部声道。
- **频谱固定口径**：先锁定「参考视图」参数集合，再考虑暴露调参（PRD 外未来项）。

---

## 9. Legacy Web

- **现状**：历史浏览器版本不再作为主线演进。
- **政策**：**不维护功能**；托管/分支 **可能删除**（以减少读者误解）。
- **用户期望管理**：PRD 读者应理解 **活跃产品是桌面仓库 main**。

---

## 10. 许可与归属

- 项目许可证以仓库根目录 **LICENSE** 为准（当前为 MIT）。
- 第三方字体/图标等素材：**归属与许可**在 **README / NOTICE（若存在）**维护；PRD 不重复粘贴法律全文以免双处漂移。

---

## 11. 测试决策

- **好测试**：验证 **可观察行为** 与 **公共接口**，避免绑定内部实现细节。
- **优先覆盖**：**纯函数与数学工具**（现有 Vitest 体系）；后续为 **关键会话逻辑**增加竖切测试（例如合并慢响度、布局降级策略等）——以 issue 切片为准。
- **Rust**：保持 **`cargo test`** 基线；与计量正确性强相关的模块应对齐 **参考向量/容许误差** 的节奏由专项 issue 承担。

---

## 12. 不在本文范围

- **具体类名/文件路径/函数签名**（易过期；以仓库为准）。
- **完整 DSP 推导**（由 **`dsp-notes`（若后续补充）** 与架构文档承载）。

---

## 13. 进一步说明

- 与 **`architecture.md` 冲突时**：以 **代码实现** 为准，随后修订文档。
- **本文修订**：重大产品意志变化应更新本 PRD，并在仓库提交说明中简述原因。

---

**文档结束。**
