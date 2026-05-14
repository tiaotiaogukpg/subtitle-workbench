# Bilingual Subtitle Aligner

基于 Electron、React、TypeScript 与 Tailwind CSS 的**中英双语字幕对齐**桌面应用。

当前处于 **Functional Skeleton Phase（功能骨架阶段）**：在已有 UI 骨架之上，已建立**统一的字幕数据模型**与 **Zustand 全局字幕状态**，全界面围绕同一份 subtitle state 运转；仍为 **mock 数据**，无真实 API / 解析器。

## 产品定位

本工具是 **AI 辅助的字幕文本对齐** 应用，不是视频编辑器。

目标工作流为：

1. 导入已完成时间轴的**中文 `.srt`**。
2. 导入完整**英文原稿 `.txt`**。
3. 后续阶段由 AI 完成英文切句与中英对齐。
4. 在界面中预览、人工修正，并最终导出**双语 `.srt`**。

**不包含**：真实视频播放、ffmpeg、波形/多轨时间轴编辑。底部区域仍为 **字幕时间轴模拟器**，由当前时间与字幕行的 `start` / `end` 驱动高亮与预览文案。

## 当前实现

### UI 与桌面体验（Phase 1 延续）

- Electron 桌面壳；`electron-vite` + React + TypeScript + Tailwind
- 主工作台布局：字幕列表、编辑区、对齐监控、底部时间轴、Problems 区域
- **浅色 / 深色主题**（`theme.css` + `data-theme`，设置内可切换并持久化）
- **设置**与 **开始 AI 对齐** 工作流弹窗：`createPortal` 至 `document.body`，桌面式内边距与区块密度（非居中阅读型布局）
- 设置项：API 密钥区、AI 对齐参数、导出选项、外观；对齐工作流弹窗为独立配置草案（仍为 mock 流程）

### 字幕状态架构（Functional Skeleton）

- **类型系统**（`src/renderer/src/types.ts`）  
  - `SubtitleStatus`：`confirmed` | `low_confidence` | `manual` | `unmatched`  
  - `CandidateMatch`：`id`、`text`、`confidence`  
  - `SubtitleLine`：`id`（`number`）、`start` / `end`（毫秒）、`chinese` / `english`、`confidence`、`status`、`candidates[]`、`problems[]`、`manuallyEdited`
- **全局 Store**（`src/renderer/src/store/subtitleStore.ts`，**Zustand**）  
  - `subtitles`、`currentSubtitleId`  
  - `selectSubtitle`、`setSubtitles`、`updateSubtitle`  
  - `updateConfidence`、`updateStatus`、`replaceEnglish`  
  - `addProblem`、`removeProblem`  
  - 辅助：`selectCurrentSubtitle(state)` 解析当前行
- **Mock 数据**（`src/renderer/src/mocks/subtitles.ts`）  
  - 导出 `initialSubtitleLines`：**默认为空数组**（无本地示例字幕）；导入/解析接入后通过 `setSubtitles` 写入 store。
- **与 UI 的接线**（`App.tsx`）  
  - 导航列表、编辑区、候选卡片、时间轴预览文案、Problems 列表均从 **同一 store** 读取/更新，避免字幕相关的 props drilling  
  - 播放时间、对齐会话、设置等仍可在本文件内用本地 state（后续可再抽离）

### 尚未实现

- 真实 `.srt` / `.txt` 导入与解析
- DeepSeek 或其它模型 API
- AI 英文切句与语义对齐算法
- 双语 `.srt` 导出实现
- 真实媒体解码与 ffmpeg

## 技术栈

- Electron  
- electron-vite  
- React  
- TypeScript  
- Tailwind CSS  
- Vite  
- **Zustand**（字幕全局状态）

## 目录结构

```text
.
├── src
│   ├── main
│   │   └── index.ts
│   ├── preload
│   │   └── index.ts
│   └── renderer
│       ├── index.html
│       └── src
│           ├── App.tsx
│           ├── main.tsx
│           ├── styles.css
│           ├── theme.css
│           ├── types.ts
│           ├── store
│           │   └── subtitleStore.ts
│           └── mocks
│               └── subtitles.ts
├── electron.vite.config.ts
├── tailwind.config.ts
├── postcss.config.cjs
├── tsconfig.json
└── package.json
```

## 开发与构建

安装依赖：

```bash
npm install
```

启动开发（Electron + Vite）：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

预览构建结果：

```bash
npm run preview
```

## 安全说明

当前阶段 **不实现** DeepSeek 或任何联网对齐逻辑。

后续接入 API 时建议：

- 请求与密钥处理放在 **Electron main** 或独立安全后端，**不要**写在 renderer 源码中。
- 渲染进程仅通过 **preload + `contextBridge`** 暴露受限 API。
- 保持 `nodeIntegration: false`、`contextIsolation: true`。

当前窗口默认安全配置：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

## 阶段路线图

### Phase 1：UI 骨架（已完成）

- 主界面、设置 / 对齐弹窗、mock 交互与时间轴模拟器

### Functional Skeleton：字幕状态（进行中 / 基线已建立）

- 统一 `SubtitleLine` / `CandidateMatch` / `SubtitleStatus` 类型  
- Zustand `subtitleStore` 作为字幕 **Single Source of Truth**  
- `initialSubtitleLines` 默认为空；导入后由 `setSubtitles` 填充
- Navigator、Editor、Candidates、Timeline 预览、Problems 与 store 对齐

### Phase 2：文件与导出（规划）

- SRT / 文稿解析与写入磁盘
- 时间轴与播放头与真实文件时间码对齐
- 双语 SRT 导出

### Phase 3：DeepSeek 接入（规划）

- 英文切句、语义匹配、批量对齐、置信度与低置信策略

### Phase 4：质检系统（规划）

- CPS、行数、过长行等规则与 Problems 面板深度联动

## 界面方向

紧凑、可读的**桌面工具**风格（参考 VS Code、Cursor、Figma Desktop 等信息密度）：

- 分区与卡片层级清晰；弹窗内边距与内容区宽度面向工作台而非网页长表单
- 当前字幕编辑区视觉权重最高；元数据与 Problems 为次要信息
- 状态以徽章呈现；候选为可点卡片
- 预览区为示意叠字（非视频解码）

核心始终围绕**字幕文本对齐**，而非视频剪辑。