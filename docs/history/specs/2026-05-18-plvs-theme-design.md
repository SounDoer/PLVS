# PLVS Theme System Design

**Date:** 2026-05-18  
**Scope:** Design token system overhaul + official PLVS Dark theme definition  
**Strategy:** Complete clean-slate rebuild — all existing AudioMeter themes retired, new system starts fresh under the PLVS brand

---

## 背景与目标

v0.1.0 是 PLVS 的第一次公开发布（前身 AudioMeter）。借此机会彻底重建设计 token 系统，达成三个目标：

1. **文档准确** — `docs/design-tokens.md` 与代码实现完全对齐，无遗留占位符
2. **代码干净** — 所有旧的 `--ui-color-*` 和过渡期命名从代码中清除
3. **视觉有意图** — 每个色值、间距值都经过设计确认，不是历史遗留的随机值

所有现有主题（`audiometer-dark`、`audiometer-light`、`audiometer-ember`）视为过渡遗产，可全部清理重建。

---

## 设计决策汇总

| 维度 | 决策 |
|------|------|
| 整体方向 | 暖色调深灰 + 橙色品牌色（"现代工具"风格） |
| 品牌主色 | `#fb923c` Orange 正橙 |
| 背景底色 | 暖灰系，非中性冷灰 |
| 字体 | Inter（UI 文字）+ JetBrains Mono（所有动态数字） |
| 间距密度 | 紧凑型，panel-gap 与 shell-gap 统一 |
| 主题数量 | 先交付 PLVS Dark，Light 和其他主题后续迭代 |

---

## Token 架构（三层）

```
Palette      原始色值（oklch / hex）。存于 builtinThemes.js 和 shadcnSemanticPreset.js。
             不直接暴露给组件使用。

Semantic     shadcn 标准 CSS 变量（--background, --primary 等）。
             由 applyShadcnSemanticTokensToDocument() 写入。
             shadcn 组件和 Tailwind 语义类直接消费。

Component    AudioMeter/PLVS 特有的 --ui-* 变量，无 shadcn 等价项。
             由 applyThemeToDocument() 和 applyLayoutToDocument() 写入。
             按命名空间分组：typography、spacing、radius、dataviz。
```

**规则：** 组件只能消费 Semantic 层或 Component 层，不能直接引用 Palette 层的原始值。

---

## 色彩系统

### Layer 1 — Shell 语义色（Semantic tokens）

PLVS Dark 主题的具体色值：

| Token | 值 | 作用 |
|-------|-----|------|
| `--background` | `oklch(0.13 0.01 55)` ≈ `#131110` | 窗口底色，最深的暖灰 |
| `--foreground` | `oklch(0.96 0.006 70)` ≈ `#f5f0ea` | 主要文字，暖白色 |
| `--card` | `oklch(0.195 0.012 50)` ≈ `#1e1b17` | 面板背景，比底色亮一档 |
| `--card-foreground` | 同 `--foreground` | 面板内文字 |
| `--popover` | 同 `--card` | Popover 背景 |
| `--popover-foreground` | 同 `--foreground` | Popover 文字 |
| `--primary` | `#fb923c` | 品牌主色 Orange，最重要的交互元素 |
| `--primary-foreground` | `oklch(0.13 0.01 55)` ≈ `#131110` | 橙色按钮上的文字 |
| `--secondary` | `oklch(0.258 0.012 50)` ≈ `#2a2620` | 次级容器背景 |
| `--secondary-foreground` | 同 `--foreground` | 次级容器文字 |
| `--muted` | 同 `--secondary` | 静音表面 |
| `--muted-foreground` | `oklch(0.63 0.015 55)` ≈ `#9e9488` | 次要文字，暖灰褐色 |
| `--accent` | 同 `--secondary` | 强调表面 |
| `--accent-foreground` | 同 `--foreground` | 强调表面文字 |
| `--border` | `oklch(1 0 0 / 9%)` | 边框，极淡白色线 |
| `--input` | `oklch(1 0 0 / 14%)` | 输入框边框 |
| `--ring` | `#fb923c` | Focus ring，同品牌色 |
| `--destructive` | `oklch(0.65 0.22 25)` | 错误/危险状态（暖红） |
| `--destructive-foreground` | `oklch(0.985 0 0)` | 危险色上的文字 |
| `--radius` | `0.625rem` | 基础圆角（Card 级别） |

> `--chart-1` 到 `--chart-5` 暂不使用，保留 shadcn 默认值即可。

### Layer 2 — 信号语义色（Signal Component tokens）

用于传达"好 / 中 / 差"状态含义，不从品牌出发，从直觉语义出发。

| Token | 值 | 作用 |
|-------|-----|------|
| `--ui-signal-corr-good` | `#34d399` | 相关性好（绿） |
| `--ui-signal-corr-mid` | `#9e9488` | 相关性中性（暖灰，同 muted-fg） |
| `--ui-signal-corr-bad` | `#f97373` | 相关性差（红） |
| `--ui-signal-peak-sample` | `#fb923c` | Sample Peak 保持线（品牌橙） |
| `--ui-signal-peak-true` | `#f97373` | True Peak 保持线（红，更严格） |
| `--ui-signal-tp-max` | `#f97373` | TP MAX 超限文字（红） |

**Meter 渐变**（Peak 柱状条，功能色，不受品牌影响）：

| Token | 值 | 区域 |
|-------|-----|------|
| `--ui-meter-grad-top` | `#f97373` | 削波区（红） |
| `--ui-meter-grad-mid` | `#fbbf24` | 警告区（黄） |
| `--ui-meter-grad-mid-stop` | `46%` | 渐变过渡点 |
| `--ui-meter-grad-bottom` | `#34d399` | 安全区（绿） |

### Layer 3 — 图表描线色（Chart Component tokens）

全部在橙色系内用明度差异区分主次，不引入额外颜色。

| Token | 值 | 轨道 |
|-------|-----|------|
| `--ui-chart-momentary` | `#fb923c` | Loudness M · live（主要，正橙） |
| `--ui-chart-momentary-snap` | `#fcd34d` | Loudness M · snap（次要，浅金） |
| `--ui-chart-shortterm` | `#e8824a` | Loudness ST · live（铜橙，区分 M） |
| `--ui-chart-shortterm-snap` | `#fed7aa` | Loudness ST · snap（最次要，浅橙白） |
| `--ui-chart-selection` | `#fcd34d` | 选区基准线（浅金） |
| `--ui-chart-vectorscope-live` | `#fb923c` | Vectorscope 实时路径 |
| `--ui-chart-vectorscope-snap` | `#fcd34d` | Vectorscope 快照路径 |
| `--ui-chart-spectrum-live` | `#fb923c` | Spectrum 实时描线 |
| `--ui-chart-spectrum-snap` | `#fcd34d` | Spectrum 快照描线 |

### 其他 Component 色

| Token | 值 | 作用 |
|-------|-----|------|
| `--ui-metric-row-bg` | `rgba(255,255,255,0.04)` | 数据行默认背景 |
| `--ui-metric-row-hover-bg` | `rgba(255,255,255,0.07)` | 数据行 hover 背景 |
| `--ui-metric-row-toggle-on-bg` | `rgba(251,146,60,0.10)` | 选中行背景（橙色调） |
| `--ui-metric-row-toggle-on-glow` | `rgba(251,146,60,0.25)` | 选中行边框发光 |
| `--ui-metric-toggle-on-label` | `#fb923c` | 选中行标签文字色 |
| `--ui-chart-target-line` | `rgba(251,146,60,0.4)` | 响度目标基准线 |

---

## 字体系统

两种字体族：

```css
--ui-font-sans: "Inter", system-ui, sans-serif;
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace;
```

**核心规则：** 所有实时变化的数字用 `--ui-font-mono` + `tabular-nums`，静态 UI 文字用 `--ui-font-sans`。

### 7 个排版角色

| # | 角色 | Token | 大小 | 字重 | 字体 | 颜色 | 使用位置 |
|---|------|-------|------|------|------|------|----------|
| 1 | App Title | `--ui-fs-app-title` | 16px | 800 | Inter | foreground（首字母 primary） | Header "PLVS"，Settings 标题 |
| 2 | Panel Title | `--ui-fs-panel-title` | 12px | 600 | Inter | muted-foreground | 各面板 CardTitle |
| 3 | Axis | `--ui-fs-axis` | 11px | 400 | JetBrains Mono | muted-foreground | 图表刻度、频率标签、时间轴 |
| 4 | Display | `--ui-fs-display` | 13px | 400/600 | JetBrains Mono | label: muted / value: signal color | 叠加在图表上的动态值 |
| 5a | Metric Meta | `--ui-fs-metric-meta` | 12px | 500 | Inter | muted-foreground | 响度指标行标签 + 单位 |
| 5b | Metric Value | `--ui-fs-metric-value` | 20px | 600 | JetBrains Mono | foreground | 响度指标行数值 |
| 6 | Status | `--ui-fs-status` | 11px | 400 | Inter | muted-foreground | Footer 状态栏 |
| 7 | Controls | `--ui-fs-controls` | 14px | 500/700 | Inter | primary button: `--primary-foreground`；outline button / label: `--foreground` / `--muted-foreground` | 按钮(700)、表单标签(500) |

> Metric Meta 使用 uppercase + letter-spacing 增强可读性。

---

## 间距系统

整体为**紧凑型**设计，适合桌面工具类 App，屏幕空间优先用于显示数据。

### 核心规则：节奏统一

**`--ui-panel-gap` 与 `--ui-shell-gap` 使用相同的值。** 这样 Header↔内容区、内容区↔Footer、面板↔面板，所有主要分隔间距保持同一视觉节奏。

### Shell

| Token | 值 | 作用 |
|-------|-----|------|
| `--ui-shell-max-w` | `1600px` | 最大内容宽度 |
| `--ui-shell-pad` | `0.8rem` | 外边距 base |
| `--ui-shell-pad-lg` | `1.2rem` | 外边距 lg 断点 |
| `--ui-shell-gap` | `0.55rem` | 主区域垂直间距 base |
| `--ui-shell-gap-lg` | `0.6rem` | 主区域垂直间距 lg |

### Header / Footer

| Token | 值 |
|-------|-----|
| `--ui-header-pad-x` | `0.9rem` |
| `--ui-header-pad-y` | `0.55rem` |
| `--ui-header-action-gap` | `0.35rem` |
| `--ui-footer-pad-x` | `1rem` |
| `--ui-footer-pad-y` | `0.65rem` |

### Panel

| Token | 值 | 说明 |
|-------|-----|------|
| `--ui-panel-pad-x` | `0.7rem` | 面板水平内边距 |
| `--ui-panel-pad-y` | `0.5rem` | 面板垂直内边距 |
| `--ui-panel-title-gap` | `0.4rem` | 面板标题与内容间距 |
| `--ui-panel-footer-gap` | `0.4rem` | 图表区与下方信息行间距 |
| `--ui-panel-gap` | `= --ui-shell-gap`（0.55rem） | **面板间距，与 shell-gap 统一** |
| `--ui-splitter-bar-thickness` | `1px` | 可拖拽 splitter 条的视觉宽度 |

### Metric Row

| Token | 值 |
|-------|-----|
| `--ui-metric-row-min-h` | `2rem` |
| `--ui-metric-row-pad-x` | `0.5rem` |
| `--ui-metric-row-pad-y` | `0.3rem` |
| `--ui-metric-row-gap` | `0.45rem` |
| `--ui-metric-inline-gap` | `0.4rem` |
| `--ui-metric-title-gap` | `0.4rem` |
| `--ui-metric-list-gap` | `0.45rem` |

### Modal（Settings Sheet）

| Token | 值 |
|-------|-----|
| `--ui-modal-pad` | `1.25rem` |
| `--ui-modal-gap` | `1rem` |
| `--ui-modal-header-gap` | `1.25rem` |
| `--ui-modal-action-pad-x` | `0.75rem` |
| `--ui-modal-action-pad-y` | `0.25rem` |

---

## 圆角系统

| Token | 值 | 作用 |
|-------|-----|------|
| `--radius` | `0.625rem` | 基础圆角（Card 级，shadcn 原生） |
| `--ui-radius-modal` | `1rem` | Sheet / 覆盖层圆角 |
| `--ui-radius-pill` | `9999px` | 完整胶囊形（Badge 等） |
| `--ui-radius-metric-row` | `0.375rem` | 数据行内圆角 |

---

## 需清理的旧 Token（实施时删除）

以下旧命名需从代码中完全清除，替换为上方的新系统：

**颜色（直接替换为 shadcn 语义变量）：**
```
--ui-color-page-bg          → var(--background)
--ui-color-text-primary     → var(--foreground)
--ui-color-text-secondary   → var(--muted-foreground)
--ui-color-text-muted       → var(--muted-foreground)
--ui-color-panel-bg         → var(--card)
--ui-color-panel-bg-splitter→ var(--secondary)
--ui-color-inset-bg         → var(--muted)
--ui-color-border-default   → var(--border)
--ui-color-brand            → var(--primary)
--ui-color-radius-card      → var(--radius)
```

**信号色重命名：**
```
--ui-color-corr-*               → --ui-signal-corr-*
--ui-color-peak-*               → --ui-signal-peak-*
--ui-color-tp-max               → --ui-signal-tp-max
```

**Metric / Chart 组件色重命名：**
```
--ui-color-metric-row-bg        → --ui-metric-row-bg
--ui-color-metric-row-hover-bg  → --ui-metric-row-hover-bg
--ui-color-metric-row-toggle-*  → --ui-metric-row-toggle-*
--ui-color-metric-toggle-*      → --ui-metric-toggle-*
--ui-color-loudness-target-line → --ui-chart-target-line
--ui-color-target-value         → --ui-chart-target-line（合并）
--ui-color-settings-overlay     → 由 shadcn Sheet 自带样式处理，删除
--ui-color-inset-dark           → 由 --muted 替代，删除
```

**布局重命名：**
```
--ui-article-pad-*          → --ui-panel-pad-*
--ui-section-title-gap      → --ui-panel-title-gap
--ui-section-gap            → --ui-panel-gap
--ui-settings-modal-*       → --ui-modal-*
--ui-metrics-*              → --ui-metric-*
--ui-inline-value-gap       → --ui-metric-inline-gap
--ui-spectrum-svg-pad       → --ui-chart-pad
--ui-history-svg-pad        → --ui-chart-pad
--ui-hud-inset              → --ui-chart-hud-inset
--ui-*-display-*-inset      → --ui-chart-inset-top / --ui-chart-inset-bottom
--ui-axis-gap-*             → --ui-chart-axis-gap
--ui-fs-section             → --ui-fs-panel-title
--ui-fs-axis-value/unit     → --ui-fs-axis
--ui-fs-extra               → --ui-fs-display
--ui-fs-action              → --ui-fs-controls
--ui-fs-settings-heading    → --ui-fs-panel-title
--ui-radius-card            → var(--radius)
```

---

## 实施顺序建议

1. 更新 `src/theme/shadcnSemanticPreset.js` — 写入 PLVS Dark semantic 值
2. 更新 `src/theme/builtinThemes.js` — 清理三个旧主题，建立 `plvs-dark` 条目
3. 更新 `src/preferences/applyDocumentTheme.js` — 按新 token 名写入 Component 层
4. 更新 `src/preferences/data.js` — 调整间距值（panel-gap → 0.55rem）
5. 运行 `npm run theme:generate` — 重新生成 `src/generated/theme-fallbacks.css`
6. 全局搜索旧 `--ui-color-*` 命名，在组件中逐一替换
7. 更新 `docs/design-tokens.md` — 与本文档对齐，删除迁移注释
