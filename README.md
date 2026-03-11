# Log Reading Tool (Electron, Node-only)

一个桌面日志工具，支持：

- 选择日志文件后按页读取（可设置每页行数）
- 支持跳转到指定页
- 实时逐行追踪新增日志
- 实时区支持自动滚动开关
- 标记并读取最后阅读位置（书签）
- 每行日志以独立条目展示，边界清晰

## 快速开始

```bash
npm install
npm start
```

## 打包（Windows amd64）

```bash
npm run pack:win
```

默认产物：

- `dist/Log Reading Tool Setup 0.1.0.exe`（Windows x64 安装包）
- `dist/win-unpacked/`（免安装目录）

## 使用说明

1. 点击“选择日志文件”
2. 在“分页阅读”中设置“每页行数”，用“上一页/下一页/跳转”查看
3. 可点击“刷新最新”跳到最后一页，或开启“10秒自动刷新”同步当前页与总页数
4. 点击“保存进度”记录当前分页位置
5. 点击“回到上次进度”恢复最近保存的阅读位置
6. 切换到“实时阅读”后点击“开始实时”，初始仅加载最近 5 条，随后持续追加新日志

## 进度存储

阅读进度会保存在 Electron 的用户数据目录中的 `bookmarks.json`。

## GitHub Actions 构建与发布

已配置两段式工作流：

- `.github/workflows/auto-tag.yml`
	- 触发：push 到 `master/main`
	- 动作：自动创建唯一 `build-*` 标签并推送
- `.github/workflows/build-packages.yml`
	- 触发：push `build-*` 或 `v*` 标签
	- 动作：构建 + 发布 Release

构建目标：

- Windows amd64
- macOS amd64
- macOS arm64

发布策略：

- `build-*`：发布为预发布（Auto Build）
- `v*`：发布为正式版本（Release）

下载产物：

1. 进入 GitHub `Releases` 页面或对应 workflow run
2. 在 Release Assets / Artifacts 中下载：
	 - `*.exe`（Windows）
	 - `*.dmg`（macOS）
	 - `*.zip`（macOS）
