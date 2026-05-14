# Bilingual Subtitle Aligner

基于 Electron、React、TypeScript 与 Tailwind CSS 的**中英双语字幕对齐**桌面应用。

当前处于 **Phase 1：UI 骨架** 阶段，重点为桌面壳层、mock 字幕工作流与交互视觉模型。

## 产品定位

本工具是 **AI 辅助的字幕文本对齐** 应用，不是视频编辑器。

目标工作流为：

1. 导入已完成时间轴的**中文 `.srt`**。
2. 导入完整**英文原稿 `.txt`**。
3. 后续阶段由 AI 完成英文切句与中英对齐。
4. 在界面中预览、人工修正，并最终导出**双语 `.srt`**。

**不包含**：真实视频播放、ffmpeg、波形/多轨时间轴编辑。底部区域仅为 **字幕时间轴模拟器**，当前由 mock 数据驱动。

## 当前实现（Phase 1）

已实现：

- Electron 桌面壳
- React + TypeScript 渲染进程
- Tailwind CSS 样式
- 现代深色桌面 UI
- Mock 字幕数据
- 字幕导航列表（可选中）
- 中文 / 英文大文本编辑区
- 可点击的 AI 候选匹配卡片
- 本地编辑状态
- 设置弹窗 UI
- Mock 对齐状态侧栏
- 字幕时间轴模拟器（播放 / 暂停 / 拖动）
- 深色预览区（居中叠字示意，无真实解码）

尚未实现：

- 真实 `.srt` 解析
- 真实 `.txt` 导入
- DeepSeek API 接入
- AI 英文切句
- 语义对齐算法
- 双语 `.srt` 导出
- 真实媒体播放
- ffmpeg

## 技术栈

- Electron
- electron-vite
- React
- TypeScript
- Tailwind CSS
- Vite

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
│           ├── types.ts
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

Phase 1 **故意不实现** DeepSeek 或任何联网对齐逻辑。

后续接入 API 时建议：

- 请求与密钥处理放在 **Electron main** 或独立安全后端，**不要**写在 renderer 源码中。
- 渲染进程仅通过 **preload + `contextBridge`** 暴露受限 API。
- 保持 `nodeIntegration: false`、`contextIsolation: true`。

当前窗口默认安全配置：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

## 阶段路线图

### Phase 1：UI 骨架（当前）

- 按设计稿搭建主界面与设置界面
- 使用 mock 数据
- 支持选中、编辑、候选项点击、设置弹窗、时间轴模拟器

### Phase 2：字幕数据逻辑（规划）

- SRT 解析 / 导出
- 字幕状态模型
- 基于真实时间码的时间轴模拟
- 双语 SRT 导出

### Phase 3：DeepSeek 接入（规划）

- 英文切句
- 中英语义匹配
- 批量对齐
- 置信度与低置信标记

### Phase 4：质检系统（规划）

- CPS
- 行数检测
- 字幕过长检测
- Problems 面板跳转

## 界面方向

当前 UI 为紧凑、可读的**现代深色桌面**风格，参考 VS Code、Obsidian、Discord 等信息密度与层级习惯：

- 分区清晰、留白与圆角一致
- 当前字幕内容视觉权重最高
- 元数据与 Problems 为次要信息
- 状态以徽章呈现
- 候选为可点卡片
- 预览区为纯黑底示意（非视频）

核心始终围绕**字幕文本对齐**，而非视频剪辑。