# PLVS Pre-Release Design

**Date:** 2026-05-18  
**Version target:** 0.1.0  
**Current version:** 0.0.15

---

## 背景

AudioMeter 项目准备对外正式发布。发布前需完成：产品改名、代码收口、对外呈现。采用两拍策略：先发 0.1.0 版本包，再上 Landing Page + 公告。

---

## 产品名称

**PLVS**（读作 "plus"）

- **P** = Peak
- **L** = Loudness
- **V** = Vectorscope
- **S** = Spectrum

四个模块首字母的缩写，视觉上读作 PLUS（拉丁字母 V = U），呼应拉丁语 *PLVS VLTRA*（更进一步）。名字简洁、有设计感、含义自洽。

---

## 第一拍：0.1.0 发版

### 1. 改名 PLVS

需要修改的位置：

| 文件 | 字段 | 改为 |
|------|------|------|
| `package.json` | `name` | `plvs` |
| `package.json` | `description` | 更新为 PLVS 相关描述 |
| `src-tauri/tauri.conf.json` | `productName` | `PLVS` |
| `src-tauri/tauri.conf.json` | `identifier` | `com.soundoer.plvs` |
| `src-tauri/tauri.conf.json` | `windows[].title` | `PLVS` |
| `src-tauri/Cargo.toml` | `package.name` | `plvs` |
| `README.md` | 标题与描述 | 全部替换为 PLVS |

**localStorage 迁移：**  
现有 key `audiometer:workspace:v1` 需要在应用启动时做一次迁移：读取旧 key，写入新 key `plvs:workspace:v1`，删除旧 key。避免用户数据丢失。

**GitHub 仓库：**  
将仓库从 `SounDoer/AudioMeter` 改名为 `SounDoer/plvs`（GitHub 会自动重定向旧链接）。

### 2. README 重写

**目标：** 面向下载用户的桌面版 README，删除 legacy 网页版内容。

**结构：**
1. 一句话说明：PLVS 是什么（实时音频计量桌面工具，Peak / Loudness / Vectorscope / Spectrum）
2. 下载方式：GitHub Releases 链接，Windows NSIS / macOS DMG
3. 安装摩擦说明：
   - **macOS Gatekeeper：** `xattr -cr /Applications/PLVS.app`（未公证的提示"已损坏"处理）
   - **Windows SmartScreen：** "更多信息" → "仍要运行"（无代码签名时的提示处理）
4. 本地开发快速上手（开发者用）
5. 许可证

**删除内容：** legacy 网页版的麦克风权限说明、虚拟声卡配置教程、浏览器要求等（这些属于 `legacy-web` 分支）。

### 3. 版本号 & CHANGELOG

**版本对齐（三处）：**
- `package.json` → `"version": "0.1.0"`
- `src-tauri/tauri.conf.json` → `"version": "0.1.0"`
- `src-tauri/Cargo.toml` → `version = "0.1.0"`

运行 `npm run version:check` 确认一致。

**CHANGELOG 新增条目（用户视角）：**
```
## [0.1.0] - 2026-05-XX

First public release of PLVS.

Real-time desktop audio metering for Windows and macOS.
Four metering modules: Peak, Loudness (LUFS / EBU R128), Vectorscope, Spectrum.
Customisable workspace layout with split-tree panels and tab stacks.
```

### 4. GitHub Release 质量

- Release 说明里附至少一张应用截图，展示四个模块同屏
- 列出下载文件说明：哪个是 Windows 安装包，哪个是 macOS DMG
- 附安装摩擦处理说明的简短版本

---

## 第二拍：Landing Page

**地址：** `plvs.soundoer.com`

### 内容结构

```
┌─────────────────────────────────────┐
│  PLVS                               │  ← Logo / 名称
│  Real-time audio metering           │  ← 一句话描述
│  [Download for Windows] [for macOS] │  ← 下载按钮
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  应用截图或动图（全宽展示）           │
└─────────────────────────────────────┘

┌──────────┬──────────┬──────────┬────┐
│  Peak    │ Loudness │ Vector-  │ S  │  ← 四模块介绍
│  采样峰值 │ LUFS/EBU │ scope   │ p  │
│          │  R128    │ 相位相关  │ e  │
└──────────┴──────────┴──────────┴────┘

┌─────────────────────────────────────┐
│  Windows / macOS                    │  ← 平台支持说明
│  免签名安装提示（SmartScreen/         │
│  Gatekeeper 处理说明）               │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  GitHub · MIT License · v0.1.0      │  ← Footer
└─────────────────────────────────────┘
```

### 技术方案

- **静态页面**，部署到 GitHub Pages（单独仓库或主仓库 `gh-pages` 分支）
- 技术栈：HTML + CSS（或 Vite + React，与主项目同栈），无后端
- 绑定子域名 `plvs.soundoer.com`（DNS CNAME 指向 GitHub Pages）
- 下载按钮直链指向 GitHub Releases 的对应文件

---

## 执行顺序

1. 改名 PLVS（代码 + 仓库）
2. localStorage 迁移逻辑
3. README 重写
4. 版本号升到 0.1.0，CHANGELOG 补充
5. 截图准备
6. 打 `v0.1.0` 标签，触发 CI 发版
7. Landing Page 设计 & 开发
8. 部署 + 绑定子域名

---

## 非目标（本次不做）

- 代码签名 / Apple 公证
- 应用内自动更新
- 社区 / 社交媒体发布（Landing Page 上线后再考虑）
- i18n

---

**文档结束。**
