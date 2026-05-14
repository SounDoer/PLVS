# Handoff: AudioMeter Workspace Layout 重构

> 给 Claude Code 的实现包。包含：详尽的设计文档 + 可运行的 HTML 原型（含完整源码）。
>
> **项目目标**：把现有的固定栅格面板改造成可配置的 Dock + Tabs 工作区。

---

## 包内文件

| 路径 | 内容 |
|---|---|
| `README.md` | 本文件 —— 总览、保真度说明、文件索引、给实现者的建议路径 |
| `AudioMeter-Layout-Spec.md` | **详细设计规范** —— 数据模型、交互判定、视觉规范、状态管理、实施顺序、验收清单。**必读** |
| `prototype/AudioMeter Layouts.html` | 可运行的 HTML 原型（直接用浏览器打开） |
| `prototype/js/*.jsx` | 原型源码（React/JSX，inline Babel 转译） |

---

## 关于原型文件 ⚠️

`prototype/` 里的 HTML/JSX 文件是 **设计参考原型，不是可直接复制的生产代码**。它们用 inline React + Babel 演示了目标交互与视觉效果，但要在真实项目（Tauri 2 + Rust + React/Vite）中实现时，应遵循项目已有的模式：

- 使用项目现有的 state 管理方案（Zustand / Jotai / Redux 等，不要为此引入新 lib）
- 沿用现有的 TypeScript 类型与命名风格
- 复用现有的 6 个音频可视化组件（Peak / Loudness / Spectrum 等），**不要重写这些音频组件**，只重写包裹它们的布局/槽位/标签系统
- 持久化用 localStorage 或 Tauri Store 插件，与项目其他偏好的存储方式保持一致

原型用 inline Babel 转译只是为了快速迭代，正式实现应该是预编译的 TypeScript + Vite。

## 保真度

**High-fidelity（hifi）** —— 颜色、字体、间距、动效、状态变化、键盘交互都已细化到具体数值。但因为本次的核心是**交互系统**而非视觉风格，几个具体取舍：

- **必须严格还原**：数据模型（`Region` / `Slot` / `Tab` 结构）、拖拽落点判定算法、各状态切换的行为
- **建议保持**：CSS 变量取值、关键尺寸（顶栏 48px、Activity Bar 44px、Slot 头部 36px 等）
- **可以调整**：具体颜色（如果项目有自己的主题系统就用项目的）、图标的具体路径（可以替换成项目用的图标库，比如 lucide-react）、动画曲线时长

---

## 如何浏览原型

1. 直接在浏览器中打开 `prototype/AudioMeter Layouts.html`
2. 顶栏切换 **Bento Grid / Dock + Tabs / Free Float** 三种布局
3. **重点看 Dock + Tabs 这一种** —— 这是要实现的方案
4. 试着拖动 Tab 到不同位置感受落点提示
5. 切换右上角的 preset 下拉看不同预设
6. 点左侧 Activity Bar 切换模块焦点

---

## 实施建议（详见 Spec 第 8 章）

按这个顺序提 PR 风险最低：

1. 基础数据模型（types + store + 默认值 + 持久化 hook，无 UI）
2. 静态 Dock 渲染（按 state 显示，不带交互）
3. 区域分隔条拖动
4. Tab 切换 + slot 折叠/关闭
5. Tab 拖拽（区域内 reorder）
6. 跨区域 + 拆分/合并的落点判定 + 视觉反馈
7. Activity Bar
8. Hidden Tray + 可见性 Popover
9. 预设系统 + Save as preset 对话框
10. 全屏覆盖层
11. 键盘快捷键（P1）

---

## 几个原型踩过的坑（避免你重复）

详见 Spec 第 9 章 「给实现者的提示」。摘要：

- **拖拽不要用 react-dnd 等第三方库**，原生 `mousemove + elementsFromPoint` 已经够用且更可控
- **`useRaf` 的闭包问题**：rAF 回调里读 React state 会拿到陈旧值。要用 `useRef` 同步最新回调函数
- **ResizeObserver 在某些容器中不触发**：需要 `getBoundingClientRect` + `window.resize` 监听器作为 fallback
- **不要给元素的 `width` / `height` 加 CSS transition**：会和 ResizeObserver 互相触发，导致测量循环抖动
- **图标用 inline SVG（stroke-based, currentColor）**而不是字体图标，方便跟主题色联动

---

## 与 Rust 后端的协作

本次重构**不需要修改 Rust 端代码**，但建议在实施验收清单最后一条（隐藏模块不订阅数据）时，与 Rust 端约定订阅/取消订阅协议（伪代码见 Spec 附录 B）。这能显著降低 Spectrogram 等大数据量模块在隐藏时的 CPU/IPC 负载。

---

## 设计决策摘要

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 布局范式 | Bento Grid / **Dock + Tabs** / Free Float | Dock + Tabs | 专业工具的成熟范式，VS Code/Figma/Logic Pro 都用类似系统；Tab 合并能节省空间；树形结构易序列化 |
| 持久化 | localStorage / Tauri Store / Rust 端文件 | localStorage（默认） | 简单可靠；后续可平滑迁移到 Tauri Store |
| 拖拽实现 | react-dnd / dnd-kit / **原生 mouse 事件** | 原生 | 避免引入大型依赖；交互定制度高 |
| 折叠侧栏 | VS Code 风格全收起 / 不做 | 不做 | 用户明确表示不需要 |

---

## 文档阅读顺序建议

1. 先通读 **AudioMeter-Layout-Spec.md** 第 0-2 章理解背景与决策
2. 在浏览器打开 `prototype/AudioMeter Layouts.html` 玩 5 分钟感受交互
3. 仔细看 Spec 第 3-7 章的数据模型与交互判定
4. 对照 `prototype/js/dock.jsx` 看具体实现（特别是 `removeTabFromDock` / `insertTabAt` / `onTabDragStart`）
5. 开始按 Spec 第 8 章的顺序拆 PR

---

## 联系点 / 需要你判断的事

Spec 中明确标了「实现细节由 CC 决定」的几处：

- State 管理 lib 的选择
- 持久化 schema 的版本与迁移策略
- 图标库的选择（原型用 inline SVG，可以换成项目用的）
- Save as preset 对话框的具体设计（原型未实现）
- 全屏的过渡动画（原型为瞬间切换）

遇到原型未覆盖的边界情况，按「最小惊讶原则」实现即可，必要时记 issue 让 designer 跟进。
