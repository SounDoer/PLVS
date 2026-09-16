# AudioMeter App Chrome（Header + Footer）— 设计文档

> 给 Claude Code 的实现说明。配套交付物：可交互原型 `Refined A - Interactive.html`。
>
> **目标读者**：Tauri 2 + Rust + React/Vite 项目的实现者。
> **范围**：仅顶部 header 与底部 status bar 的视觉与交互。工作区布局参考另一份文档 `AudioMeter-Layout-Spec.md`。

---

## 0. TL;DR

把 header / footer 从「信息平铺」改造成 **极简动作栏 + 极简上下文条**：

- **Header**：左侧只有一个 **Status Pill**（状态点 + 标签 + 内嵌 session timer），右侧是 5 个动作（START · Clear · Device · Layout · Settings），其中 START 与其余按钮之间用一根细分隔条隔开
- **Footer**：只保留 **Device** 与 **Ref** 两个上下文字段
- **状态机仅两态**：`READY`（灰）与 `LIVE`（红、脉动）。START / STOP 按钮的视觉、状态点、内嵌计时器三者颜色同步
- **App 不再显示 "AudioMeter" 字样**——身份由窗口标题 / favicon 承担，chrome 内部不再重复

详见 §3 / §4。

---

## 1. 背景

旧 chrome 的问题：

1. **信息密度不均**：header 左侧塞了 Device 下拉 + Preset 下拉 + 网格 icon 三个配置控件，但都没有视觉分组
2. **Preset 控件太隐形**：一个无标签的小下拉框，用户扫一眼不知道是干嘛的
3. **Device 名占用空间过大**：动辄 280px 宽，遇到长设备名（"扬声器 (4- Apogee Symphony Desktop)"）反而要省略号
4. **Header 缺乏运行时反馈**：meter 在跑还是没跑，header 完全看不出来
5. **Footer 信息重复**：`Device: Not connected` 和 header 的 Device 字段重复
6. **Footer 文案啰嗦**：`Ready - click Start to begin monitoring` 已经被 START 按钮自身表达过
7. **`Build: dev` 不该出现在生产 UI**

---

## 2. 设计决策

### 2.1 主方案：Minimal Chrome（采纳）

- 把所有低频配置（Preset / Device / Layout）压成 icon button，只在点开 popover 时才看到细节
- 把运行状态从「文字 + 按钮」拆解成「**状态 pill** + 颜色变化的传输按钮」两组冗余信号，扫一眼就懂
- Footer 退化为「**纯上下文条**」——不放任何"状态"或"行动指示"，只回答两个问题："监听的是哪个设备？""按什么标准衡量？"

### 2.2 不采纳的方向（仅做记录）

- **B · Live / realtime**：header 实时显示 RMS 数字 + 大型 timer 块。信息量最大，但 header 变成"半个 meter"，与下方主体的数据展示职责重叠
- **C · 双层 header**：主行传输 + 副行配置。功能性强，但占用 ~76px 垂直空间，对一个本来就要展示密集数据的工具不友好

---

## 3. 视觉与组件规范

### 3.1 整体尺寸

| 元素 | 值 |
|---|---|
| Header 高 | 48px |
| Footer 高 | 28px |
| Header 内边距 | 0 14px |
| Footer 内边距 | 0 14px |
| Header / Footer 与主体分隔线 | `1px solid var(--border)` |

### 3.2 Header 组件树

```
.topbar
├── .status[data-state]                    // 状态 pill，左侧唯一元素
│   ├── .dot
│   ├── .label                             // "READY" / "LIVE"
│   └── .clock                             // session timer，按需显示
├── .spacer                                 // flex: 1
└── .actions
    ├── .transport                          // START / STOP 主按钮
    ├── .divider                            // 1px × 18px 细分隔条
    ├── button.icon-btn[data-tip="Clear"]
    ├── button.icon-btn[data-tip="Audio device"]
    ├── button.icon-btn[data-tip="Layout & modules"]
    └── button.icon-btn[data-tip="Settings"]
```

### 3.3 Status Pill

```
+--------------------------------+
| ●  READY                       |   ← idle，灰
+--------------------------------+

+----------------------------------------+
| ●  LIVE  │  00:03:47                   |   ← running，红，点脉动
+----------------------------------------+

+----------------------------------------+
| ●  READY │  00:03:47                   |   ← stopped after run，灰但保留时长
+----------------------------------------+
```

| 属性 | 值 |
|---|---|
| 形状 | `border-radius: 99px` |
| 内边距 | `5px 12px 5px 10px` |
| 字号 | 11px / `font-weight: 700` / `letter-spacing: 0.08em` / `text-transform: uppercase` |
| 状态点 | 8×8 圆形 |
| Label 与 clock 之间的分隔 | `1px solid` 竖线，padding-left: 9px |
| Clock 字号 | 11.5px / 600 / `font-variant-numeric: tabular-nums` / 非大写 |

**配色规则（两个状态切换都需要 200ms transition）**：

| 状态 | 背景 | 描边 | label/dot 色 | clock 色 |
|---|---|---|---|---|
| `ready` | `var(--bg-2)` | `var(--border)` | `var(--text-dim)` / 灰 | `var(--text-dim)` |
| `live` | `rgba(248,113,113,0.08)` | `rgba(248,113,113,0.32)` | `var(--red)` | `var(--red)` |

`live` 状态下，状态点额外有 `box-shadow: 0 0 0 3px rgba(248,113,113,0.18), 0 0 6px var(--red)`，并应用 1.4s ease-in-out 无限 `pulse` 动画（opacity 1 → 0.5 → 1）。

**Clock 的显示规则**见 §4.2。

### 3.4 Transport 按钮（START / STOP）

```
START (idle)                STOP (live)
+-----------+               +-----------+
| ▶  START  |   青色实心     | ■  STOP   |  红色描边、空心
+-----------+               +-----------+
```

| 属性 | START | STOP |
|---|---|---|
| Background | `var(--accent)` (#4ec3ff) | `transparent` |
| Color | `#08252e` | `var(--red)` |
| Border | none | `1px solid rgba(248,113,113,0.4)` |
| Hover | `filter: brightness(1.08)` | `background: rgba(248,113,113,0.08)` |

> 设计意图：idle 时 START 是诱人的实心彩色按钮——"请点我开始监听"。running 时 STOP 变成低视觉重量的描边按钮——避免误触停止，且把视觉注意力交还给主体的实时数据。

**通用规格**：
- 高 32px
- 内边距 `0 14px`
- 圆角 `var(--r-md)` (6px)
- 字号 11.5px / 700 / `letter-spacing: 0.06em`
- 左侧 10×10 SVG icon（▶ 或 ■），与文字间距 6px

### 3.5 Icon 按钮（Clear / Device / Layout / Settings）

| 属性 | 值 |
|---|---|
| 尺寸 | 32 × 32 |
| 圆角 | `var(--r-md)` |
| Icon 尺寸 | 14 × 14，`color: currentColor` |
| 默认色 | `var(--text-dim)` |
| Hover | `background: var(--bg-2)`，`color: var(--text)` |
| Tooltip | 通过 `data-tip` 属性，hover 时显示在按钮下方 6px 处 |

**4 个 icon 的语义与 SVG**：

| Icon | 含义 | path 关键形状 |
|---|---|---|
| Clear | 删除/重置 session | 垃圾桶 |
| Device | 打开音频设备选择 popover | 喇叭 + 声波 |
| Layout & modules | 打开布局 / 模块可见性 popover（含 layout 切换、modules 勾选） | 2×2 田字格 |
| Settings | 打开应用设置 popover | 齿轮 |

SVG path 直接参考原型 `Refined A - Interactive.html`。

**禁用态（Clear 专用）**：
- `opacity: 0.4`、`cursor: not-allowed`
- Hover 时不再变色
- 启用条件见 §4.3

### 3.6 Transport / Icon 之间的分隔条

```
[ START ]  │  [Clear] [Device] [Layout] [Settings]
           ↑
        细分隔条
```

- 宽 1px，高 18px，颜色 `var(--border)`
- 左右各 4px 外边距
- 设计意图：把"主行动"和"次级动作"分开，让 START 单独占一个视觉区块

### 3.7 Footer（Status Bar）

```
+--------------------------------------------------------------+
| DEVICE  扬声器 (Apogee Symphony Desktop)  │  REF  EBU R128 (−23 LUFS) |
+--------------------------------------------------------------+
```

| 元素 | 规格 |
|---|---|
| 高 | 28px |
| 字号 | 11px / `color: var(--text-dim)` |
| 分隔条 | 1px × 12px / `background: var(--border)` |
| 字段间距 | 14px |
| Key 标签 | 10px / `color: var(--text-mute)` / `letter-spacing: 0.06em` / `text-transform: uppercase` |
| Value | `color: var(--text)` / `font-variant-numeric: tabular-nums` |

**两个字段**：

1. **Device** — 当前监听的设备名
   - 未连接（且从未运行）：值显示 `Not connected`，颜色变为 `var(--text-dim)`
   - 已连接：显示完整设备名，颜色 `var(--text)`
2. **Ref** — 响度参考标准
   - 始终显示，例如 `EBU R128 (−23 LUFS)`
   - 与 settings 中的 reference 选择联动

**已移除项**（不要再加回）：
- 状态文案 `Ready - click Start...`
- 状态 pill `METER: STOPPED`（合并到 header 状态点）
- Session 时长（合并到 header 状态 pill 内的 clock）
- `Build: dev`（dev-only 信息，应仅在 dev 环境通过 console / about 对话框暴露）

---

## 4. 状态机与数据模型

### 4.1 State

```ts
interface AppChromeState {
  /** 运行状态。仅两态 */
  state: 'ready' | 'live';

  /** 当前 session 已累计的运行时长（毫秒）。Clear 重置为 0 */
  elapsedMs: number;

  /** 当前 device 显示名，null = 未连接 */
  deviceName: string | null;

  /** 响度标准。来自 settings */
  reference: { standard: 'EBU R128' | 'ATSC A/85' | 'BS.1770'; target: number };
}
```

### 4.2 Status Pill 派生显示

```ts
function renderStatusPill(s: AppChromeState) {
  if (s.state === 'live') {
    return { label: 'LIVE', clock: format(s.elapsedMs), variant: 'live' };
  }
  // ready
  return {
    label: 'READY',
    clock: s.elapsedMs > 0 ? format(s.elapsedMs) : null, // null = 不渲染
    variant: 'ready',
  };
}
```

时间格式：`HH:MM:SS`，超过 99h 也用 3 位（不做截断）。

### 4.3 Clear 按钮启用条件

```ts
const canClear = state === 'live' || elapsedMs > 0;
```

简单说：**只要 session 有任何数据**（正在跑或跑过），Clear 就可点击。

### 4.4 START / STOP 行为

```ts
function onTransportClick() {
  if (state === 'ready') {
    state = 'live';
    runStartedAt = Date.now();
    startTimerLoop(); // 每 200ms 更新 clock
  } else {
    state = 'ready';
    elapsedMs += Date.now() - runStartedAt;
    stopTimerLoop();
  }
}

function onClearClick() {
  if (!canClear) return;
  if (state === 'live') stopAndReset(); // 同时停止并清零
  elapsedMs = 0;
}
```

### 4.5 Timer 实现

- 用 `requestAnimationFrame` 节流到 ~10 Hz（每帧检查时间戳间隔，≥100ms 才更新 DOM），避免触发整个 React 树重渲染
- **绝不在 React state 中存 `now`**——把 `runStartedAt` 存为 ref，在 timer 回调里直接操作 DOM 文本节点；或者使用 `useSyncExternalStore` 订阅一个独立的时钟 store
- 时钟显示的 `font-variant-numeric: tabular-nums` 防止数字宽度跳动

### 4.6 持久化

- `elapsedMs` **不持久化**——应用重启视为新 session
- `reference` 通过 settings store 持久化（与本文档无关）
- 当前 `deviceName` 由 Rust 端推送，前端只读

---

## 5. 交互细节

### 5.1 键盘快捷键

| 键 | 行为 |
|---|---|
| `Space` | START / STOP 切换（焦点不在输入框时）|
| `Cmd/Ctrl + K` | Clear（仅在 canClear 时生效）|
| `Cmd/Ctrl + ,` | 打开 Settings popover |

### 5.2 Popover 触发

| 按钮 | popover 内容 |
|---|---|
| Device | 当前默认设备 + 所有可用输入/输出设备列表，单选 |
| Layout & modules | Layout 切换段控（Bento/Dock）+ 6 个模块的可见性勾选 + Preset 下拉 |
| Settings | 应用设置（采样率/缓冲区/响度标准/主题等）。设计另起一份文档 |

**Popover 通用规格**：
- 锚定方式：顶对齐按钮底边 + 6px，右对齐按钮右边
- 背景 `var(--bg-3)`、描边 `var(--border-strong)`、圆角 `var(--r-md)`
- 最小宽 220px
- 外部 mousedown 自动关闭

### 5.3 Tooltip

- 仅 icon button 显示，通过 `data-tip` 属性
- hover 100ms 后显示，移开立即隐藏
- 文案：`Clear` / `Audio device` / `Layout & modules` / `Settings`

### 5.4 动画与过渡

| 元素 | transition |
|---|---|
| Status pill `color` / `background` / `border` | 200ms |
| Status pill `dot` | 200ms（额外的 pulse 是 1.4s 无限循环）|
| Transport 按钮 `color` / `background` / `border` | 150ms |
| Icon button `color` / `background` | 120ms |

---

## 6. 实施建议（顺序）

1. **抽象 `<StatusPill>` 组件** — 接收 `{ state: 'ready'|'live', clock: string|null }`，所有视觉变化由 props 驱动
2. **抽象 `<TransportButton>` 组件** — 接收 `{ state, onClick }`，内部根据 state 切换图标/文字/样式类
3. **抽象 `<IconButton>` 通用组件** — 接收 `{ icon, tip, disabled, onClick }`
4. **重写 `<TopBar>`** — 拆掉旧的 Device pill、Preset dropdown、Layout segmented control、Clear/Settings 文字按钮
5. **重写 `<StatusBar>`** — 简化到 2 个字段
6. **接入 Session Timer** — 用独立 store + rAF 循环，与 React 状态解耦
7. **接入 Audio Device 状态** — Rust 端推送的 device name 与连接状态
8. **接入 Layout & Modules popover** — 把原 popover 内容塞进新的 icon 按钮
9. **键盘快捷键** — 全局监听 + 焦点判断

---

## 7. 验收清单

- [ ] App 启动后 header 左侧显示 `● READY`，无 timer
- [ ] 点 START → pill 变红 + 脉动，clock 出现并 ~10Hz 走表；transport 按钮变为红色描边 STOP
- [ ] 点 STOP → pill 变灰但 clock 保留显示，颜色变灰；transport 回到青色 START
- [ ] Clear 按钮在 `elapsedMs > 0` 时启用，点击后 clock 消失，pill 回到只显示 `READY`
- [ ] 未连接设备时 footer 显示 `DEVICE Not connected`（dim 色），连接后显示设备名
- [ ] Footer Ref 字段始终显示当前响度标准
- [ ] Header 不再出现 "AudioMeter" 字样
- [ ] Footer 不再出现 `Build: dev`、`METER: STOPPED` pill、状态文案
- [ ] 4 个 icon button hover 时都出现 tooltip
- [ ] Status pill 颜色切换有 200ms 过渡，不是硬切
- [ ] LIVE 状态下窗口失焦后再回来，clock 仍准确（基于 `runStartedAt` 而非帧计数）

---

## 8. 边界情况

- **窗口最小化后再恢复**：clock 应基于 `Date.now() - runStartedAt` 重新计算，不受 rAF 暂停影响
- **设备中途被拔掉**：Rust 端通知 `deviceName = null`；header 状态保持 LIVE 但 footer Device 变灰显示 `Not connected`；可考虑在 status pill 加 `state='warning'` 第三态（黄色），P1
- **超长设备名**：footer Device value 用 `text-overflow: ellipsis`，hover 显示完整 tooltip
- **响度标准切换**：footer Ref 实时更新，无需 session 重启
