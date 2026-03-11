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
2. 设置“每页行数”，用“上一页/下一页”分页查看
3. 点击“开始实时”进入追加读取模式
4. 点击“标记当前位置”保存当前页/实时偏移
5. 点击“读取书签”恢复之前的位置

## 书签存储

书签会保存在 Electron 的用户数据目录中的 `bookmarks.json`。
