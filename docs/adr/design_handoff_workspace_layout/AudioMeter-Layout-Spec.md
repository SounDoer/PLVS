# AudioMeter 工作区布局重构 — 设计文档

> 给 Claude Code 的实现说明。配套交付物：参考原型 `AudioMeter Layouts.html` + `js/` 目录下的 React 源码。
>
> **目标读者**：Tauri 2 + Rust + React/Vite 项目的实现者。
> **范围**：仅前端布局系统的重构；Rust 端音频采集与分析不在此次改动范围内。

---

## 0. TL;DR

把现有面板从「固定栅格」改造成 **可配置的 Dock + Tabs 工作区**，核心特性：

- 6 个监测模块（Peak / Loudness / Vectorscope / Spectrum / Spectrogram / Loudness Stats）可在 **左 / 中 / 右 / 底** 四个区域中自由编排
- 同一区域可以纵向堆叠多个**槽（Slot）**，每个槽内可放多个模块作为 **Tabs**
- 用户可拖动标签在区域之间移动、合并、拆分
- 区域之间用可拖动的**分隔条**调整尺寸
- 左侧 **Activity Bar** 提供 6 个模块的快速可见性切换
- 支持 **命名预设**（Default / Broadcast / Compact / Spectrum Focus），用 localStorage 持久化

实现可参考原型，但**不要求像素级照搬**——优先保证：(1) 数据模型一致；(2) 交互判定逻辑一致；(3) 视觉风格与现有 AudioMeter 深色主题协调即可。

---

## 1. 背景与目标

### 当前问题
- 面板布局固定为 3 行 6 列的网格，无法让用户根据使用场景调整
- 右侧 Loudness Stats 数值列表占了 6 行，但很多用户只关心其中 1-2 个指标
- 字段被截断（"MOMEN..." / "SHORT-T..."），视觉重量不合理
- Vectorscope 在小尺寸下细节看不清，Spectrogram 占满底部又显冗余

### 目标
- 用户能根据当前任务（广播合规 / 母带 / 频谱分析）**自由编排**模块
- 减少屏幕空间浪费：不需要的模块隐藏、不重要的模块合并成 Tabs
- 保留**专业感**：交互细腻、视觉克制、不要 web 化
- **不破坏现有的实时数据流**：Rust 后端推送的所有模块数据接口保持不变

### 非目标
- 多窗口/分离窗口（暂不做）
- 主题切换（深色主题保留即可）
- 模块内部参数的配置 UI（每个模块的 ⋯ 菜单是 P1）

---

## 2. 设计决策

### 2.1 主方案：Dock + Tabs（采纳）

选择理由：
- **专业工具的成熟范式**：VS Code、Figma、Logic Pro、Final Cut 都用类似的 Dock 系统，专业用户认知成本最低
- **空间利用率高**：Tabs 能让 Spectrum + Spectrogram 这样关联性强的模块共用区域
- **状态可序列化**：树形结构容易保存/加载，便于做命名预设
- **不需要解决重叠**：相比 Free Float 自由摆放，区域+槽位的约束更符合数据密集型工具的使用习惯

### 2.2 备选方案（不采纳，仅做记录）

**Bento Grid（12 列 × 12 行栅格吸附）**
- 优点：视觉规整，每个模块都有最佳尺寸
- 缺点：用户需要心算栅格单位，碰撞处理逻辑复杂，不支持 Tabs 合并

**Free Float（自由浮动窗口）**
- 优点：最大自由度，类似 Pro Tools
- 缺点：容易重叠，需要 z-order 管理，对桌面端音频工具来说过于松散

> 原型 `AudioMeter Layouts.html` 中三种布局都做了完整实现，可以切换体验对比。**最终只实现 Dock + Tabs 即可**。

---

## 2.5 实施前确认的技术决定

> 本节记录实施前与开发者讨论后确认的决定，补充设计文档未明确的部分。

| 决定点 | 结论 | 理由 |
|---|---|---|
| 语言 | 继续用 **JavaScript + JSDoc**，不迁移 TypeScript | 项目全部为 `.jsx`，保持一致 |
| LoudnessStats | **从 LoudnessPanel 拆出**，成为独立第 6 个模块组件 | 当前嵌在 LoudnessPanel 内；拆出后才能作为独立 tab 自由编排 |
| 音频数据流 | **Audio Context**：App.jsx 创建 context，各模块组件直接消费 | Dock / Region / Slot 中间层不经手音频数据；零新依赖；模块接口干净 |
| CSS 变量 | **映射到项目现有 shadcn token**（`--background`、`--border`、`--primary` 等），不新增变量 | 项目已有完整主题系统；shadcn token 已覆盖所需语义 |
| 顶栏布局 | `Logo \| 设备选择 \| 预设下拉 \| 可见性图标 \| → \| Clear \| Start \| Settings` | 新控件插在设备选择右侧，保持现有右侧操作区不变 |
| 状态管理 | **React Context + useReducer**（WorkspaceState），零新依赖 | 项目无现有状态管理库；与 AudioData context 风格一致 |
| 持久化 | **localStorage**（key: `audiometer:workspace:v1`），schema 版本不匹配时 fallback 到 DEFAULT | 与现有布局持久化方式一致；Tauri Store 已安装，未来可平滑迁移 |
| 图标 | 使用项目已有的 **lucide-react**，为每个模块选择合适图标 | 项目已使用 lucide-react，无需引入新图标库 |
| 拖拽 | **原生 mouse 事件** + `elementsFromPoint`，不引入 react-dnd / dnd-kit | 项目未用拖拽库；原型验证此方案可行 |

---

## 3. 数据模型

### 3.1 TypeScript 类型定义

```ts
export type ModuleId =
  | 'peak'
  | 'loudness'
  | 'loudnessStats'
  | 'vectorscope'
  | 'spectrum'
  | 'spectrogram';

export type RegionKey = 'left' | 'center' | 'right' | 'bottom';

export interface Slot {
  /** 该槽包含的模块（按 tab 顺序）*/
  tabs: ModuleId[];
  /** 当前激活的 tab，必须存在于 tabs 数组中 */
  activeTab: ModuleId;
  /** 折叠时只显示 tab 栏，body 隐藏 */
  collapsed: boolean;
}

export interface Region {
  /**
   * 区域大小：
   * - left/right 表示宽度（px）
   * - bottom 表示高度（px）
   * - center 不需要此字段（自适应填充）
   * - 0 表示该区域当前为空（不显示）
   */
  size?: number;
  slots: Slot[];
}

export interface DockState {
  regions: Record<RegionKey, Region>;
}

export interface WorkspaceState {
  /** 当前应用的布局 */
  dock: DockState;
  /** 哪些模块可见。不可见的模块不会出现在任何区域 */
  visibleModules: ModuleId[];
  /** 当前焦点模块（用于高亮显示）*/
  focusId: ModuleId | null;
  /** 当前激活的预设 id；null 表示自定义未命名状态 */
  activePresetId: string | null;
}
```

### 3.2 默认布局

```ts
export const DEFAULT_DOCK_STATE: DockState = {
  regions: {
    left: {
      size: 220,
      slots: [
        { tabs: ['peak'], activeTab: 'peak', collapsed: false },
        { tabs: ['vectorscope'], activeTab: 'vectorscope', collapsed: false },
      ],
    },
    center: {
      slots: [
        { tabs: ['loudness'], activeTab: 'loudness', collapsed: false },
        // 演示 tab 合并：spectrum + spectrogram 共用一个槽
        { tabs: ['spectrum', 'spectrogram'], activeTab: 'spectrum', collapsed: false },
      ],
    },
    right: {
      size: 260,
      slots: [
        { tabs: ['loudnessStats'], activeTab: 'loudnessStats', collapsed: false },
      ],
    },
    bottom: { size: 0, slots: [] },
  },
};
```

### 3.3 不变量（实现需保证）

1. `slot.activeTab` 必须在 `slot.tabs` 中。任何修改 tabs 数组的操作之后要重置 activeTab
2. 空的 slot（tabs.length === 0）应自动从 region 中移除
3. 一个 ModuleId 在整个 DockState 中只能出现在一个 slot 的 tabs 数组里
4. `visibleModules` 与 DockState 中实际存在的 modules 在概念上独立——某个模块可以在 dock 中存在但被设为不可见（用户隐藏了但保留位置）

---

## 4. 模块系统

### 4.1 模块清单

| ID | 显示名 | 最小宽 | 最小高 | 适合区域 |
|---|---|---|---|---|
| `peak` | Peak | 140 | 200 | left / right |
| `loudness` | Loudness | 320 | 200 | center |
| `loudnessStats` | Loudness Stats | 160 | 200 | left / right |
| `vectorscope` | Vectorscope | 180 | 200 | left / right |
| `spectrum` | Spectrum | 280 | 180 | center / bottom |
| `spectrogram` | Spectrogram | 320 | 160 | center / bottom |

> 「适合区域」只是默认放置的偏好，用户拖到任何区域都允许。

### 4.2 模块组件接口

每个音频模块组件应该：
- 占满父容器（`width: 100%; height: 100%`）
- 通过 props 接收一个 `compact` boolean，用于在小尺寸下切换紧凑显示（例如 Loudness Stats 的标签缩短为 5 字符）
- **从 AudioDataContext 消费音频数据**，不通过 props 接收（见 §2.5 音频数据流决定）
- 内部自己管理 ResizeObserver / rAF，**不依赖**布局系统传入精确尺寸

```js
// JSDoc（项目为 JavaScript，不迁移 TypeScript）

/**
 * @typedef {{ compact: boolean }} ModuleProps
 */

/**
 * @typedef {{
 *   id: ModuleId,
 *   title: string,
 *   minWidth: number,
 *   minHeight: number,
 *   Component: React.FC<ModuleProps>,
 *   Icon: React.FC,  // 16×16，来自 lucide-react
 * }} ModuleDef
 */

/** @type {Record<ModuleId, ModuleDef>} */
export const MODULE_REGISTRY = { /* ... */ };
```

**AudioDataContext** 提供的数据形状（从 App.jsx 当前 state 抽取）：

```js
// AudioDataContext 包含现有 App.jsx 中所有音频相关 state：
// displayAudio, displaySpectrumPath, displaySpectrumPeakPath,
// displayVectorPath, spectrogramSnapRef, correlation,
// getSamplePeakLineColor, fmt, hasTpMaxValue, tpMaxText,
// vsGridDiagInset, vsGridDiagFar, vectorscopePairX/Y,
// loudness history 相关（histCurves, primaryMetrics 等）,
// selectedOffset, running, ...
```

> **注意**：项目里现有的 Peak/Loudness/Spectrum 等模块组件已经实现，本次改动**不重写音频可视化核心逻辑**，只需：(1) 将数据来源从 props 改为从 AudioDataContext 消费；(2) 新增 `compact` prop 支持；(3) 拆出 LoudnessStats 为独立组件。

---

## 5. 交互规范

### 5.1 标签（Tab）拖拽与落点判定

**触发**：用户在 slot 的 tab 标签上 mousedown 并移动超过 4px 阈值。

**判定算法**（每次 mousemove）：
1. `document.elementsFromPoint(x, y)` 取所有命中元素
2. 找最近的带 `data-slot` 属性的元素 → 取出其 `data-region` 和 `data-slot-index`
3. 命中 slot 后，进一步判断 zone：
   - 鼠标 Y 在 `[data-slot-tabs]` 矩形内 → `zone = 'tabs'`，并按 tab pill X 中线计算 `tabIndex` 插入位置
   - 鼠标 Y 在 `[data-slot-body]` 的上半 → `zone = 'above'`
   - 鼠标 Y 在 `[data-slot-body]` 的下半 → `zone = 'below'`
4. 如果未命中任何 slot，但命中带 `data-empty-region` 的元素 → `zone = 'empty-region'`，target 为该 region
5. 否则 `hoverDrop = null`，不显示任何提示

**视觉反馈**：
- 跟随鼠标的 ghost 标签（显示模块名）
- 拖动中的源 tab pill 透明度降为 35%
- 落点高亮：
  - `tabs` zone：源 slot 的 tab 栏顶部覆盖蓝色虚线带 + 在目标 tab 间显示 3px 蓝色竖条
  - `above` / `below` zone：slot body 内对应半区显示蓝色虚线框 + 文字标签 "Insert above" / "Insert below"
  - `empty-region` zone：空区域提示边框由灰变蓝
- 空 region 在拖动期间整体显形（拖动开始前隐藏）

**释放（mouseup）应用变更**：

```ts
function applyDrop(state: DockState, sourceId: ModuleId, drop: DropTarget): DockState {
  // 1. 从源位置移除该 module
  const removed = removeTabFromDock(state, sourceId);
  // 2. 调整目标 slotIndex：如果源 slot 因移除而被销毁，且源 slot 的 index < target.slotIndex，target.slotIndex 要 -1
  // 3. 按 zone 插入：
  //    tabs        → slot.tabs.splice(tabIndex, 0, id); slot.activeTab = id
  //    above       → region.slots.splice(slotIndex, 0, { tabs:[id], activeTab:id, collapsed:false })
  //    below       → region.slots.splice(slotIndex + 1, 0, { ... })
  //    empty-region→ region.slots.push({...}); 如果原 region.size 为 0 则恢复默认大小
}
```

> 参考实现见 `js/dock.jsx` 中的 `removeTabFromDock` / `insertTabAt`。

### 5.2 区域分隔条

- **left / right 分隔条**：垂直方向，6px 宽，鼠标变 `ew-resize`
- **bottom 分隔条**：水平方向，6px 高，鼠标变 `ns-resize`
- 拖动时实时更新对应 region 的 `size`
- 约束：
  - left/right: `clamp(160, containerWidth * 0.45)`
  - bottom: `clamp(100, containerHeight * 0.65)`
- 双击分隔条恢复默认 size（**P1**，可不实现）

### 5.3 槽位操作

每个 slot 头部右侧有 3 个按钮：

| 按钮 | 行为 |
|---|---|
| 折叠 (─/+) | `slot.collapsed = !slot.collapsed`；折叠后 slot 高度变为 tab 栏高度（36px）|
| 全屏 (⛶) | 当前激活 tab 进入全屏覆盖层，再次点击退出 |
| 关闭 (×) | 隐藏该 slot 中所有 tabs 的对应模块（即从 visibleModules 中移除） |

**Tab pill 上的关闭按钮**（× 图标）：
- 仅在 `slot.tabs.length > 1` 时显示
- 单击隐藏该单个模块

### 5.4 Activity Bar

左侧 44px 宽固定栏，上下排列 6 个 32×32 模块图标。

**状态**：
- `hidden`：模块被隐藏 — 灰色 (`--text-mute`)
- `visible`：模块可见但未 focus — 中性色 (`--text-dim`)
- `focused`：当前焦点 — 蓝色背景 + 左边 2px 蓝色指示条

**点击行为**：
- 隐藏时点击：显示该模块 + focus 它
- 可见但未 focus：focus 该模块
- 已 focus：再次点击隐藏

**Hover**：显示 tooltip（模块名 + 当前状态提示）

> Icon 设计：每个模块一个 16×16 SVG，stroke-based，颜色用 `currentColor` 跟随状态。原型中已实现，可以直接复用 SVG path。

### 5.5 模块可见性管理

除了 Activity Bar，顶栏右上角的「网格图标」也提供一个 Popover：
- 列出所有 6 个模块，前面带勾选框
- 显示当前状态（Shown / Hidden / Collapsed）
- 点击切换可见性

**隐藏的模块**显示在工作区右下角的 **Hidden Tray**：
- 浮层，列出所有被隐藏的模块名
- 单击芯片让该模块重新显示（恢复到上一次的位置）

### 5.6 键盘快捷键（P1，可选）

| 键 | 行为 |
|---|---|
| `1` - `6` | Toggle 第 N 个模块的可见性 |
| `F` | 当前 focus 模块进入/退出全屏 |
| `Cmd/Ctrl + 1-6` | 直接 focus 第 N 个模块 |
| `Esc` | 退出全屏 / 取消拖动 |

---

## 6. 视觉规范

### 6.1 颜色 tokens

直接使用项目现有的 CSS 变量；如果还没建立，建议以下值：

```css
:root {
  /* Surfaces */
  --bg-0: #0c0c12;       /* outermost */
  --bg-1: #14141b;       /* app body */
  --bg-2: #1a1a22;       /* module body */
  --bg-3: #22222b;       /* module/slot header */
  --bg-4: #2c2c36;       /* hover */
  --border: #2a2a33;
  --border-strong: #353541;
  --divider: #1f1f27;

  /* Text */
  --text: #e8e8ee;
  --text-dim: #9a9aa6;
  --text-dimmer: #61616d;
  --text-mute: #44444e;

  /* Accent */
  --accent: #4ec3ff;
  --accent-soft: rgba(78, 195, 255, 0.16);
  --accent-bg: #1a3a52;
}
```

### 6.2 关键尺寸

| 元素 | 值 |
|---|---|
| 顶栏高 | 48px |
| 底部状态栏高 | 28px |
| Activity Bar 宽 | 44px |
| Slot 头部高 | 36px |
| 区域分隔条厚 | 6px |
| Slot 圆角 | 10px |
| Tab pill 圆角 | 5px 5px 0 0 |
| 区域间外边距 | 6px |
| 工作区外边距 | 10px |

### 6.3 状态规范

- **Focus 高亮**：slot 边框变 `--accent`，外加 `0 0 0 1px var(--accent)` 阴影
- **Hover**：slot 边框变 `--border-strong`
- **Drag 中**：源 tab pill `opacity: 0.35`；落点 zone 显示蓝色虚线 + 标签
- **Collapsed**：slot 高度收缩到 36px（只剩 tab 栏）

---

## 7. 状态管理

### 7.1 React 状态层

> CC 自由选用 Zustand / Jotai / Redux Toolkit / Context，**根据项目已有约定**。建议把 `WorkspaceState` 作为一个独立 store，与音频数据流的 store 解耦。

核心 actions：
```ts
- setDockState(state: DockState)
- moveTab(sourceId: ModuleId, target: DropTarget)
- setActiveTab(region: RegionKey, slotIndex: number, tabId: ModuleId)
- toggleSlotCollapsed(region: RegionKey, slotIndex: number)
- toggleModuleVisible(id: ModuleId)
- setFocus(id: ModuleId)
- setFullscreen(id: ModuleId | null)
- applyPreset(presetId: string)
- saveCurrentAsPreset(name: string)
```

### 7.2 持久化

**localStorage**（推荐）：
- key: `audiometer:workspace:v1`
- 值：`JSON.stringify({ dock, visibleModules, focusId, activePresetId, customPresets })`
- 启动时读取并 hydrate；schema 版本不匹配时 fallback 到 `DEFAULT_DOCK_STATE`

**Tauri Store 插件**（可选）：
如果需要跨设备同步或更可靠的存储，使用 `@tauri-apps/plugin-store` 替代 localStorage。**写入路径建议在 Rust 端定义**，避免直接暴露文件系统给前端。

### 7.3 预设系统

```ts
interface Preset {
  id: string;
  name: string;
  builtin: boolean;
  dock: DockState;
  visibleModules: ModuleId[];
}

// 内置预设（不可编辑/删除）
const BUILTIN_PRESETS: Preset[] = [
  { id: 'default',         name: 'Default',         builtin: true, ... },
  { id: 'broadcast',       name: 'Broadcast',       builtin: true, ... },
  { id: 'compact',         name: 'Compact (Tabs)',  builtin: true, ... },
  { id: 'spectrum-focus',  name: 'Spectrum Focus',  builtin: true, ... },
];
```

预设下拉的位置：顶栏左侧（在 Layout 区右边）。点击 "Save as preset..." 弹出对话框输入名字。

---

## 8. 实施建议（顺序）

CC 可以按这个顺序拆 PR：

1. **基础数据模型**：types + reducer/store + 默认值 + 持久化 hook（不接 UI）
2. **静态 Dock 渲染**：根据 state 渲染区域 + 槽位 + tab 栏，不带交互
3. **区域分隔条**：拖动改 size
4. **Tab 切换 + slot 折叠/关闭按钮**
5. **Tab 拖拽**：先支持区域内 reorder
6. **落点判定 + 视觉反馈**：tabs / above / below / empty-region
7. **Activity Bar**
8. **Hidden Tray + 模块可见性 Popover**
9. **预设系统 + Save as preset 对话框**
10. **全屏覆盖层**
11. **键盘快捷键**（P1）

---

## 9. 给实现者的提示

- **拖拽不要用第三方库**：原型用原生 mousemove + elementsFromPoint 实现得很干净，引入 react-dnd 反而会增加复杂度。除非项目已经在用 react-dnd。
- **不要相信 React 的 state 闭包**：原型早期版本里 `useRaf` 因为闭包问题导致 SVG path 不更新，需要用 ref 同步最新回调
- **测量元素尺寸**：iframe 里 ResizeObserver 可能不工作，准备 fallback（rAF + getBoundingClientRect + window resize）
- **图标用 inline SVG 而不是字体**：原型中所有图标都是 stroke-based SVG，可以跟随主题色
- **transition 不要 transition `width` 和 `height`**：会导致测量循环抖动。位移用 `left/top` transition，尺寸不加 transition

---

## 10. 验收清单

- [ ] 默认布局加载时与原型一致（Peak + Vectorscope 在左纵列，Loudness 上中，Spectrum + Spectrogram 作为 tabs 在下中，Loudness Stats 在右）
- [ ] 拖动 Loudness Stats 标签到 Loudness 的 tab 栏可以合并；拖到 body 上半/下半可以拆分新 slot
- [ ] 双击关闭按钮 × 隐藏模块；从 Activity Bar 或 Hidden Tray 重新显示
- [ ] 切换预设后所有模块位置变化平滑（可以无动画，但不能闪烁）
- [ ] 刷新页面后布局保持不变
- [ ] 拖动分隔条调整区域大小时，模块内部的实时数据可视化不卡顿
- [ ] 全屏模块期间，Rust 端推送的实时数据正常显示
- [ ] 隐藏的模块**不应**继续接收 Rust 端的数据（性能优化，与 Rust 端约定订阅协议）

---

## 附录 A：参考原型文件清单

| 文件 | 作用 |
|---|---|
| `AudioMeter Layouts.html` | 主入口，包含完整 CSS |
| `js/modules.jsx` | 6 个音频模块的可视化组件（占位实现） |
| `js/chrome.jsx` | Module 通用包裹组件（仅用于 Bento/Float） |
| `js/bento.jsx` | Bento Grid 实现（参考用，不需要在生产中实现） |
| `js/dock.jsx` | **Dock + Tabs 实现，本次改动的核心参考** |
| `js/float.jsx` | Free Float 实现（参考用） |
| `js/app.jsx` | App shell：顶栏 / Activity Bar / 状态栏 / 布局切换 |

重点阅读：
1. `js/dock.jsx` 顶部的数据模型注释（line 1-15）
2. `removeTabFromDock` / `insertTabAt` 两个纯函数（line 35-80）
3. `onTabDragStart` 中的落点判定（line 280-340）
4. `js/app.jsx` 中的 `ActivityBar` 组件

---

## 附录 B：与 Rust 端的协作

本次重构**不需要修改 Rust 端代码**，但建议在实施第 9 项「隐藏模块不订阅数据」时，与 Rust 端约定订阅/取消订阅协议：

```rust
// 建议的 Tauri command（伪代码）
#[tauri::command]
fn subscribe_module(id: ModuleId, params: ModuleParams) -> Result<()>;
#[tauri::command]
fn unsubscribe_module(id: ModuleId) -> Result<()>;
```

前端在模块可见性切换时调用对应 command，可显著降低 CPU/IPC 负载（特别是 Spectrogram 这种数据量大的模块）。
