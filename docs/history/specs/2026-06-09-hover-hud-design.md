# Hover HUD 统一设计

**日期：** 2026-06-09  
**范围：** WaveformPanel 和 SpectrogramPanel 新增 Hover HUD；LoudnessPanel 和 SpectrumPanel 现有 hover 逻辑迁移至统一 hook。

---

## 背景

LoudnessPanel 和 SpectrumPanel 已有 hover HUD（十字线 + 信息弹窗）。现有实现通过 `useHoverState` hook 在 `App.jsx` 层集中管理状态，结果经 AudioDataContext 下发给面板。

本次目标：
1. 为 WaveformPanel、SpectrogramPanel 新增 hover HUD
2. 同步将现有两个面板的 hover 逻辑迁移至新的通用 hook，AudioDataContext 不再承载 hover 状态

---

## 架构

### 核心 hook：`useChartHover(computeFn)`

**文件：** `src/hooks/useChartHover.js`

接口：
- 入参：`computeFn: (xFrac: number, yFrac: number) => T | null`
- 返回：`{ hover: T | null, onMove: (clientX, clientY, rect) => void, onLeave: () => void }`

实现要点：
- 用 ref 同步最新的 `computeFn`（`computeRef.current = computeFn` 在每次渲染时赋值）
- `onMove` 和 `onLeave` 用 `useCallback(fn, [])` 保持引用稳定，避免触发额外 re-render
- 内部 `useState(null)` 管理 hover 状态

### 数据流变化

**删除：** `src/hooks/useHoverState.js`（整体删除）

**App.jsx：**
- 删除 `useHoverState` 调用
- 从 AudioDataContext value 中移除：`historyHover`、`spectrumHover`、`onHistoryHoverMove`、`onHistoryHoverLeave`、`onSpectrumHoverMove`、`onSpectrumHoverLeave`、`clearHoverState`

---

## 各面板实现

### LoudnessPanel（迁移）

`LoudnessPanel` 从 `useAudioData()` 读取 `histSourceList`、`effectiveOffsetSamples`、`visibleSamples`，构造 `computeFn` 调用已有的 `computeHistoryHoverPoint()`，调用 `useChartHover`，将 `hover`/`onMove`/`onLeave` 作为 props 传给 `LoudnessHistoryChart`。

HUD 显示不变：十字线 + 左上角弹窗（时间偏移、M LUFS、ST LUFS）。

### SpectrumPanel（迁移）

`SpectrumPanel` 在组件内调用 `useChartHover`，`computeFn` 就地做频率/dB 换算（无需查外部数组）。

HUD 显示不变：十字线 + 曲线圆点 + 左上角弹窗（频率、dB）。

### WaveformPanel（新增）

**新函数：** `computeWaveformHoverPoint(xFrac, mins, maxes, entryCount, effectiveOffsetSamples, visibleSamples, sampleSec, labels)`（加入 `hoverMath.js`）

逻辑：
- `xFrac` → 时间索引（与 `computeHistoryHoverPoint` 相同的右端对齐换算）
- 取对应时间切片的每声道 `max[ch]`，转换为 dBFS：`20 * log10(max(1e-9, |amp|))`
- 返回：`{ leftPct, timeLabel, channels: [{ label, dbFs }] }`

HUD：
- 竖向虚线跨所有声道 lanes（无横线，Y 轴在多 lane 下无统一含义）
- 左上角弹窗：时间偏移 + 每声道峰值 dBFS

示例弹窗：
```
−12.4s ago
L  −6.2 dBFS
R  −7.8 dBFS
```

`onMove` 绑定在现有的交互 overlay div 上（z-index 已高于 canvas，直接复用）。

### SpectrogramPanel（新增）

**新函数：** `computeSpectrogramHoverPoint(xFrac, yFrac, snaps, effectiveOffsetSamples, visibleSamples, sampleSec)`（加入 `hoverMath.js`）

逻辑：
- `xFrac` → 时间索引 → 取对应 snap（同 computeHistoryHoverPoint 的时间映射）
- `yFrac` → 频率（Hz）：调用 `hzFromFrac(yFrac)`（已在 `spectrogramMath.js`）
- 频率 → band 索引：在 `snap.bands` 上做对数域二分查找（与 `buildYToBand` 相同逻辑）
- dB：`snap.dbList[bandIdx]`
- 返回：`{ leftPct, topPct, timeLabel, freqLabel, dbLabel }`

HUD：
- 完整十字线（横线 + 竖线）
- 左上角弹窗：时间偏移 + 频率 + dB

示例弹窗：
```
−12.4s ago
2.50 kHz
−34.0 dB
```

---

## hoverMath.js 变更

新增两个纯函数（便于单元测试）：

- `computeWaveformHoverPoint(xFrac, mins, maxes, entryCount, effectiveOffsetSamples, visibleSamples, sampleSec, labels)`
- `computeSpectrogramHoverPoint(xFrac, yFrac, snaps, effectiveOffsetSamples, visibleSamples, sampleSec)`

频率格式化复用已有的 `formatSpectrumFreq()`，时间格式化复用 `formatHoverOffset()`。

新增对应测试到 `hoverMath.test.js`。

---

## 视觉规范

HUD 弹窗样式沿用现有 `LOUDNESS_HUD_BOX_POPOVER`（`rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm`）。数值使用 monospace + tabular-nums。

十字线样式：
- 竖线：`border-l border-dashed border-muted-foreground/55`
- 横线：`border-t border-dashed border-muted-foreground/40`

---

## 边界情况说明

**clearHoverState 的处理：** App.jsx 中 `clearHoverState()` 在音源切换时调用。迁移后直接删除该调用即可——hover 状态本地化后，音源切换不会造成残留（面板只在指针移动时更新 hover，指针不动时维持上一次的值，但这不影响用户体验；pointerleave 自然清空）。

**sampleSec 常量：** `computeWaveformHoverPoint` 和 `computeSpectrogramHoverPoint` 需要每样本秒数（`HIST_SAMPLE_SEC`）。确认该常量的导出位置，确保面板可直接 import 而不依赖 App.jsx 的传递。

**WaveformPanel onPointerMove 集成：** 现有 interaction overlay 已有 `onPointerMove`（用于 scrub）。hover 的 `onMove` 需在同一事件处理器内同时调用，`onLeave` 绑定到 `onPointerLeave`（目前无此监听器，需新增）。

---

## 文件改动总结

| 操作 | 文件 |
|------|------|
| 新建 | `src/hooks/useChartHover.js` |
| 扩充 | `src/math/hoverMath.js` |
| 删除 | `src/hooks/useHoverState.js` |
| 修改 | `src/App.jsx` |
| 修改 | `src/components/panels/LoudnessHistoryChart.jsx` |
| 修改 | `src/components/panels/LoudnessPanel.jsx` |
| 修改 | `src/components/panels/SpectrumPanel.jsx` |
| 修改 | `src/components/panels/WaveformPanel.jsx` |
| 修改 | `src/components/panels/SpectrogramPanel.jsx` |
| 扩充 | `src/math/hoverMath.test.js` |
