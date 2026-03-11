# TECHNOLOGY

## 1. 项目定位

本项目是一个基于 **Electron + Node.js** 的桌面日志阅读工具（Node-only 方案），目标是：

- 支持大日志文件的分页读取（按行）
- 支持实时追加日志读取（tail 模式）
- 支持阅读进度保存/恢复
- 支持分页总页数展示与自动刷新
- UI 简洁，行级条目边界清晰，时间前缀与正文有视觉区分

---

## 2. 架构总览

### 2.1 分层结构

- **Main Process（主进程）**
  - 文件选择对话框
  - 文件 IO（分页读取、最后页读取、tail 轮询）
  - 进度持久化（bookmarks.json）
  - 对 Renderer 提供 IPC API
- **Preload（桥接层）**
  - 通过 `contextBridge` 暴露受控 API 到 `window.logApi`
  - 隔离 Node 能力，避免 Renderer 直接访问系统接口
- **Renderer（渲染进程）**
  - 页面渲染与交互状态管理
  - 触发分页请求、实时订阅、进度读写
  - 本地 UI 配置持久化（字体大小、每页行数、分页自动刷新）
  - 行级展示和边界视觉样式

### 2.2 文件组织

- `main.js`：窗口创建、IPC 注册、tail 会话管理、菜单栏关闭
- `preload.js`：`window.logApi` API 暴露
- `src/logService.js`：文件元信息 + 分页/最后页读取 + 行数统计
- `src/bookmarkStore.js`：进度 JSON 存储（文件名为 bookmarks.json）
- `renderer/index.html`：界面结构
- `renderer/styles.css`：深色简洁样式
- `renderer/renderer.js`：前端状态机与交互逻辑

---

## 3. 关键技术点

### 3.1 安全模型（Electron）

窗口开启了如下安全策略：

- `contextIsolation: true`
- `nodeIntegration: false`

因此 Renderer 不能直接 `require('fs')`，所有系统能力必须走 `preload.js` 暴露的受控 IPC。

### 3.2 分页读取策略

分页核心由 `readPage(filePath, page, pageSize)` + `readLastPage(filePath, pageSize)` 组成。

`readPage` 行为：

- 使用 `fs.createReadStream + readline` 逐行扫描
- 只保留目标区间 `[startLine, endLineExclusive)` 的行
- 返回：
  - `lines: [{ no, text }]`
  - `hasPrevPage`
  - `hasNextPage`

`readLastPage` 行为：

- 单次扫描统计 `totalLines`
- 计算 `totalPages = ceil(totalLines / pageSize)`
- 计算最后页数量 `lastPageLineCount`
- 返回最后页真实行内容（与翻页到最后页一致）

特点：

- 内存友好：不将整个文件一次性读入
- 代价：当前实现为“从文件头扫描”，页码越靠后读取耗时越高

### 3.3 行数统计与总页数

新增 `countLines(filePath, forceRefresh)`：

- 用于计算分页总页数展示
- 带 `size + mtimeMs` 缓存，减少重复全量扫描
- 自动刷新时可 `forceRefresh = true` 拉取最新计数

### 3.4 实时读取（tail）策略

主进程维护单一 `tailSession`：

- `filePath`：当前追踪文件
- `position`：已读取到的字节偏移
- `leftover`：半行缓存（处理分块边界）
- `timer`：700ms 轮询

性能保护：

- 单轮最大读取字节：`512KB`
- 单轮最大推送行数：`400`

启动行为：

- 点击“开始实时”时，固定从文件尾部启动
- 仅预加载最近 `5` 条日志作为初始显示
- 后续仅追加新写入内容

轮询流程：

1. `stat` 获取最新文件大小
2. 若文件截断（size < position），回退到 0
3. 读取新增字节区间 `[position, size)`
4. 与 `leftover` 拼接后按换行切分
5. 完整行通过 `webContents.send('tail-lines')` 推送
6. 最后一段不完整内容回写到 `leftover`

### 3.5 进度存储模型（原书签）

存储位置：`app.getPath('userData')/bookmarks.json`

索引键：

- `fileKey = "${filePath}::${stats.ino}"`

进度内容（当前实现）：

- `page`
- `pageSize`
- `lineNo`
- `tailPosition`
- `savedAt`

说明：

- `ino` 用于区分同路径但被替换过的文件
- 当前未额外校验 `mtime/size`，恢复时以“尽力恢复位置”为主

### 3.6 本地 UI 配置持久化

Renderer 通过 `localStorage` 持久化：

- `logFontSize`（字体大小）
- `pageSize`（每页行数）
- `pageAutoRefresh`（10 秒自动刷新开关）

键名：`logReader.uiSettings.v1`

### 3.7 前端状态管理

Renderer 使用单对象 `state` 管理：

- 文件元信息：`file`
- 分页：`page/pageSize/totalLines/totalPages/pagingModeLastLine/pageAutoRefresh`
- 实时：`tailRunning/tailPosition/autoScroll`
- 订阅清理：`offTailListener/offTailErrorListener`

交互关键点：

- 分页：上一页/下一页/跳转页码/刷新最新/10 秒自动刷新
- 实时：开始/停止 + 自动滚动开关
- 进度：保存进度/回到上次进度

### 3.8 分页自动刷新策略

- 手动“刷新最新”：跳转并刷新到最后一页
- 自动“10 秒刷新”：仅更新总行数/总页数并刷新当前页内容，不改变当前页码

### 3.9 行级视觉与文本处理

每条日志渲染为 `.log-item` 卡片：

- 独立边框与圆角
- `white-space: pre-wrap` 保留日志换行语义
- 支持将日志中的 `<br>` / `<br/>` / `<br />` 标准化为 `\n`
- 时间前缀（如 `YYYY-MM-DD HH:mm:ss`）渲染为胶囊标签 `.log-time`
- 正文渲染为 `.log-body`，与时间视觉分层

### 3.10 错误提示与窗口行为

- 错误提示使用自定义模态框（替代原生 `alert`）
- 未选择文件时，点击依赖文件的按钮会弹窗提示
- Electron 原生菜单栏已移除
- 窗口高度按屏幕工作区动态初始化，页面布局自适应窗口高度

符合“每一行是一个条目、边界明显”的需求。

---

## 4. IPC 接口清单

Renderer 通过 `window.logApi` 调用：

- `selectLogFile()`
- `readLogPage({ filePath, page, pageSize })`
- `readLastLogPage({ filePath, pageSize })`
- `getLogLineCount({ filePath, forceRefresh })`
- `loadBookmark({ fileKey })`
- `saveBookmark({ fileKey, bookmark })`
- `startTail({ filePath, startPosition })`
- `stopTail()`
- `getTailPosition()`
- `onTailLines(handler)`
- `onTailError(handler)`

---

## 5. 打包与发布

当前打包方案：`electron-builder`

- 命令：`npm run pack:win`
- 目标：Windows x64 (`nsis`)
- 产物：
  - `dist/Log Reading Tool Setup 0.1.0.exe`
  - `dist/win-unpacked/`

说明：

- 在 Linux/WSL 交叉打包 Windows 时，签名相关步骤可能触发 `wine` 依赖。
- 当前通过 `win.signAndEditExecutable: false` 减少这类依赖，聚焦可用安装包产出。

---

## 6. 已知边界与后续优化建议

### 已知边界

- 高页码分页读取性能会下降（从文件头扫描）
- 当前未实现关键字过滤/搜索
- 当前 tail 为固定间隔轮询，不是文件系统事件驱动
- 实时初始仅回显最近 5 条，超长历史需通过分页查看

### 优化建议（按优先级）

1. 增加“行偏移索引”（可选按需缓存）以提升深页跳转性能
2. 增加关键词搜索（可选当前页/全文件）
3. 增加 tail 速度档位与最大缓存行数配置
4. 进度恢复时增加 `mtime/size` 一致性提示
5. 针对超大文件增加行偏移索引/增量索引缓存

---

## 7. 运行环境与依赖

- Node.js（建议 LTS）
- Electron 31.x
- electron-builder 24.x

开发命令：

- `npm install`
- `npm start`

打包命令：

- `npm run pack:win`
