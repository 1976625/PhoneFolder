# PhoneFolder

PhoneFolder 是一个 Windows 桌面工具，它在桌面上创建一个“像手机文件夹一样”的收纳盒/瓦片，用来管理文件、文件夹和快捷方式，方便把桌面杂物放进一个统一入口中进行整理和访问。

PhoneFolder is a Windows desktop utility that creates a “phone-folder-style” storage box on the desktop. It helps manage files, folders, and shortcuts in a compact desktop entry, making it easy to organize clutter and keep important items in one place.

PhoneFolder / 手机文件夹 / desktop folder organizer / file box / file storage box / desktop collection box / folder tile / desktop file organizer / drag and drop organizer / Windows desktop folder box / phone-style folder tile / file and folder manager

## 项目简介 / Overview

PhoneFolder 不负责管理手机本体，也不替代资源管理器。它的作用是为 Windows 桌面增加一个“文件盒子”入口：你可以把文件、文件夹、快捷方式拖进去，像手机文件夹一样统一收纳，并在需要时直接打开。

PhoneFolder does not manage a phone itself and does not replace File Explorer. Instead, it adds a “file box” entry to the Windows desktop. You can drag files, folders, and shortcuts into it, store them in one place, and open them when needed.

它更像是：

- 桌面文件收纳盒
- 文件夹入口
- 桌面整理工具
- 文件/快捷方式收纳区
- 文件管理型桌面组件

It is more like:

- a desktop file storage box
- a folder entry on the desktop
- a desktop organization tool
- a file and shortcut collection area
- a visual file management component for Windows

## 主要功能 / Features

- 在桌面上显示一个“像手机文件夹一样”的收纳盒
- 管理文件、文件夹和快捷方式
- 拖动文件进盒子，统一收纳
- 拖出文件到桌面或资源管理器
- 支持按需打开、排序、重命名、查看
- 适合压缩桌面杂物
- 提供简洁的桌面交互体验
- 不替代资源管理器，仅作为桌面入口

- show a “phone-folder-style” box on the desktop
- manage files, folders, and shortcuts
- drag files into the box for centralized storage
- drag files out to the desktop or Explorer
- support open, sort, rename, and browse
- help reduce desktop clutter
- offer a clean desktop interaction experience
- act as a file entry instead of replacing File Explorer

## 适用场景 / Use Cases

- 桌面文件收纳 / desktop file organization
- 文件夹整理 / folder organization
- 快捷方式收纳 / shortcut collection
- 桌面清理工具 / desktop cleanup tool
- 文件盒子 / file box
- 个人桌面文件入口 / personal desktop file entry
- 像手机文件夹一样的收纳体验 / phone-folder-style desktop storage experience

## 关键词 / Search Terms

PhoneFolder

desktop file box
desktop folder organizer
file storage box
folder tile
phone-folder-style desktop app
Windows desktop file organizer
desktop file collection
file and folder organizer
desktop shortcut organizer
folder entry on desktop
desktop storage box
Windows folder tile
drag and drop file organizer

## 效果预览 / Screenshot Preview

![桌面瓦片（桌面级模式）](docs/images/desktop-tiles.png)

![浮层展开（壁纸模糊 + 毛玻璃网格）](docs/images/overlay-panel.png)

![设置页](docs/images/settings.png)

## 当前进度 / Current Progress

| 阶段 | 状态 | 说明 |
|---|---|---|
| P0 脚手架 | ✅ 完成 | pnpm + Electron 43.3.0，main/preload/renderer 分层，`pnpm shot` 截图 |
| P1 视觉原型 | ✅ 完成 | 瓦片 UI、全屏浮层、壁纸模糊、开合动画 |
| P2 真实内容 | ✅ 完成 | 真实文件夹扫描、缩略图、3×3 分页、点击打开、右键菜单、fs.watch 刷新、空态/错误态 |
| P3 拖放 | ✅ 完成 | 拖入移入（重名 (n)、跨盘回退、跳过已在内）、单文件拖出、拖入高亮/toast |
| P4 系统集成 | ✅ 完成 | 托盘、设置页、开机自启、单实例、多瓦片（≤24） |
| P5 打磨打包 | ✅ 完成 | 性能实测、内存优化、electron-builder 便携版 |
| v0.6 行为修正 | ✅ 完成 | 默认空瓦片 + 从桌面拖入收纳（旧配置自动迁移）；空瓦片去图标、面板同款实线玻璃边；修复二次打开不居中 |
| v0.7 收纳位置 | ✅ 完成 | 收纳文件夹移出桌面（放到桌面同级，如同盘 `D:\手机文件夹`）；旧隐藏目录自动迁移清空 |
| v0.7.1 图标修复 | ✅ 完成 | `.lnk` / `.exe` 显示真实软件图标 |
| v0.8 交互细节 | ✅ 完成 | 修复 hover 顶部裁切、瓦片大小真正生效；点浮层标题重命名；面板隐藏 `.lnk` 后缀 |
| v0.10–v0.12 | ✅ 完成 | 拖出改为 pointer 触发原生拖拽；桌面级瓦片优化；修复重复打开问题 |

- 开发计划：[docs/开发计划.md](docs/开发计划.md)
- 阶段记录：[P1](docs/P1-进展.md) · [P2](docs/P2-进展.md) · [P3](docs/P3-进展.md) · [P4](docs/P4-进展.md) · [P5](docs/P5-进展.md) · [v0.6](docs/v0.6-进展.md) · [v0.7](docs/v0.7-进展.md)

## 发布 / 直接使用 / Release / Run

| 产物 | 大小 | 用法 |
|---|---|---|
| `release/PhoneFolder-0.12.1-setup.exe` | 102.8 MB | 安装版：双击安装（当前用户，无需管理员），自动创建桌面/开始菜单快捷方式 |
| `release/PhoneFolder-0.12.1-portable.exe` | 93.6 MB | 双击即用（自解压到临时目录运行） |
| `release/PhoneFolder-0.12.1-win.zip` | 133.1 MB | 解压后运行 `win-unpacked/PhoneFolder.exe` |

- SHA-256 前 16 位：setup `C37FF5CC7493A9C0` · portable `5BDEBB4EAE7E7183` · zip `95DB9C2858CFB6B3`
- 未签名，首次运行 SmartScreen 提示 → 「更多信息 → 仍要运行」
- 配置目录：`%APPDATA%\phone-folder\config.json`

> 本机注意：项目 `release/` 目录继承了当前会话的沙箱 ACL，直接在里面运行 EXE 会启动失败（没反应）。
> 当前版本已解压部署到 `D:\PhoneFolder\PhoneFolder-0.12.1`，桌面快捷方式与开机自启都指向它。

## 默认行为：空瓦片 + 收纳 / Default Behavior: Empty Tile + Storage Folder

- 收纳文件夹在**桌面目录的同级**：本机桌面是 `D:\deskTop`，所以收纳目录是 **`D:\手机文件夹`**。
- 首次启动自动创建这个目录，瓦片绑定它 → 默认是空的。
- 从桌面把文件/快捷方式/文件夹拖到瓦片上 → 移进收纳文件夹。
- 从浮层把条目拖回桌面 = 移出。
- 右键瓦片 → 「打开绑定文件夹」可查看管理目录。

- storage folder is placed at the same level as the desktop directory
- first launch creates the folder automatically and binds it to the tile
- dragging files, shortcuts, or folders onto the tile moves them into the storage folder
- dragging items back out from the panel removes them from the folder
- right-click the tile to open the bound folder

## 开发运行 / Development

```powershell
pnpm install
pnpm start
pnpm shot
```

## 打包 / Build

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm dist
```

## 交互 / Interaction

- 单击瓦片：展开浮层；再点瓦片位置 / 点面板外 / 按 Esc：收起
- 拖动瓦片：自由跟随移动，松手自动吸附到网格
- 右键瓦片：展开 / 打开绑定文件夹 / 重新扫描 / 添加瓦片 / 设置 / 删除此瓦片 / 退出
- 浮层：滚轮 / ←→ / 左右滑动翻页；单击条目打开
- 重命名：点浮层里的大标题 → 直接输入，Enter 保存 / Esc 取消
- 托盘：左键切换瓦片显示/隐藏；右键菜单：显示/隐藏瓦片、打开设置、打开绑定文件夹、重新扫描、退出
- 设置页：瓦片增删/更换文件夹/改显示名/打开目录/重置排序等
- 文件变化：文件夹内增删改 300ms 内自动刷新浮层和瓦片预览

- click the tile to expand the floating panel; click the tile again, click outside the panel, or press Esc to collapse it
- drag the tile to move it freely and snap to grid positions automatically
- right-click the tile to expand, open the bound folder, rescan, add a new tile, open settings, remove the tile, or exit
- the floating panel supports scroll / left-right navigation / page switching
- rename items directly from the panel title area
- tray icon provides quick show/hide, open settings, open folder, rescan, and exit
- settings page supports adding/removing tiles, changing folders, renaming, and reordering
- file changes refresh the panel and previews automatically

## 关键词补充 / Additional Search Keywords

PhoneFolder

desktop file box
desktop folder organizer
file storage box
folder tile
desktop collection box
Windows desktop file organizer
desktop file organizer
file and folder organizer
desktop shortcut organizer
folder entry on desktop
desktop storage box
Windows folder tile
drag and drop file organizer
phone-style desktop storage
desktop file management tool

## 目录结构 / Directory Structure

```text
D:\deskTop\phoneS\
├─ package.json / .npmrc / .gitignore / electron-builder.yml
├─ assets\                 icon.ico / icon.png
├─ docs\                   开发计划 + P1~P5 + v0.6~v0.12 进展
├─ scripts\                E2E / 诊断 / 截图辅助脚本
├─ shots\                  截图产物
├─ release\                打包产物
├─ src\
│  ├─ main\
│  │  ├─ main.js
│  │  ├─ windows\
│  │  └─ services\
│  ├─ preload\
│  └─ renderer\
└─ tests\unit\run.js
```

## 已知限制 / Known Limitations

- 未签名 → SmartScreen 首次提示
- 桌面级瓦片为实验特性：仅主显示器；多显示器 / 混合 DPI 未适配
- 收纳是移动语义：文件从桌面移进收纳文件夹
- 默认收纳目录在桌面同级；若手动改到桌面中，则会显示在桌面中
- 托盘「显示/隐藏瓦片」不持久化

- unsigned app → SmartScreen warning on first run
- desktop tile mode is experimental and mainly for the primary display
- storage is move-based: items are moved from the desktop into the storage folder
- default storage folder sits beside the desktop; if moved into the desktop itself it will appear there
- tray show/hide state is not persisted

## 总结 / Summary

PhoneFolder 是一个面向 Windows 桌面的文件收纳工具，它通过一个“像手机文件夹一样”的桌面盒子/瓦片，帮助用户把文件、文件夹和快捷方式收纳到一个统一入口中，形成更简洁、更有序的桌面使用体验。

PhoneFolder is a Windows desktop file organization tool that creates a phone-folder-style desktop box or tile to help users manage files, folders, and shortcuts in one unified entry point and keep the desktop cleaner and more organized.

PhoneFolder – desktop file box

PhoneFolder – desktop folder organizer

PhoneFolder – file storage box for Windows

PhoneFolder – phone-style folder tile for desktop organization

