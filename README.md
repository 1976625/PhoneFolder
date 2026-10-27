# PhoneFolder

Windows 桌面「手机文件夹」：桌面上常驻一格瓦片，单击后整屏压暗、壁纸模糊，瓦片原地放大成毛玻璃网格；点面板外 / Esc 收起。背后绑定真实文件夹，支持多个瓦片（最多 6 个）。

交互对标付费软件 DeskFolders，本项目免费自研。定位：不替代资源管理器，只在桌面上加一层「文件夹入口 + 展开层」。

## 当前进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| P0 脚手架 | ✅ 完成 | pnpm + Electron 43.3.0，main/preload/renderer 分层，`pnpm shot` 截图 |
| P1 视觉原型 | ✅ 完成 | 瓦片 UI、全屏浮层、壁纸模糊、开合动画 |
| P2 真实内容 | ✅ 完成 | 真实文件夹扫描、256px 缩略图、3×3 分页、点击打开、右键菜单、fs.watch 刷新、空态/错误态 |
| P3 拖放 | ✅ 完成 | 拖入移入（重名 (n)、跨盘回退、跳过已在内）、单文件拖出、拖入高亮/toast |
| P4 系统集成 | ✅ 完成 | 托盘、设置页（文件夹/背景/压暗/模糊/大小/自启）、开机自启、单实例、多瓦片（≤6） |
| P5 打磨打包 | ⬜ 待开始 | 动画调参、内存优化、打包便携版 |

- 开发计划：[docs/开发计划.md](docs/开发计划.md)
- 阶段记录：[P1](docs/P1-进展.md) · [P2](docs/P2-进展.md) · [P3](docs/P3-进展.md) · [P4](docs/P4-进展.md)

## 运行

```powershell
pnpm install    # 首次
pnpm start      # 启动：桌面出现瓦片 + 任务栏托盘图标
pnpm shot       # 自动截图到 shots/（瓦片态 → 展开中 → 展开态 → 收起后）
```

> 注意：本机 DSH 终端里 `ELECTRON_RUN_AS_NODE=1`，启动前需清掉该环境变量，否则 Electron 会以 Node 模式运行：
> `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; pnpm start`

## 交互

- **单击瓦片**：展开浮层；再点瓦片位置 / 点面板外 / 按 Esc：收起
- **拖动瓦片**：移动位置并写回配置
- **右键瓦片**：展开 / 打开绑定文件夹 / 重新扫描 / 添加瓦片 / 设置 / 删除此瓦片（多瓦片时）/ 退出
- **浮层**：滚轮 / ←→ / 左右滑动翻页；单击条目打开（资源管理器），浮层自动收起；右键条目有「打开 / 在资源管理器中显示 / 复制路径」
- **拖入**：从资源管理器拖文件/文件夹到瓦片或浮层 → 移入**该瓦片绑定的文件夹**（高亮 + 提示 + toast；重名自动 `(n)`；已在文件夹内跳过）
- **拖出**：浮层条目拖到资源管理器/桌面（Electron 原生拖拽，单文件限制）
- **托盘**：左键切换瓦片显示/隐藏；右键菜单：显示/隐藏瓦片、打开设置、打开绑定文件夹、重新扫描、退出
- **设置页**：瓦片增删/更换文件夹（≤6，同一文件夹去重）、背景模式、压暗程度、模糊强度、瓦片大小、开机自启
- **文件变化**：文件夹增删改 300ms 内自动刷新浮层和瓦片预览
- 空文件夹、文件夹被删/无权限都有中文提示

## 测试

```powershell
pnpm test                        # 排序/过滤/移入/设置校验单测（8 项）
node scripts/e2e-drop.js         # E2E：拖入链路（CDP 调真实 IPC）
node scripts/e2e-settings.js     # E2E：多瓦片 + 自启注册表 + 设置窗口
```

## 配置

`%APPDATA%\phone-folder\config.json`（v2）：

```json
{
  "version": 2,
  "tiles": [
    { "id": "t1", "folder": "D:\\deskTop", "x": 1812, "y": 24, "size": 84, "opacity": 1 }
  ],
  "overlay": { "columns": 3, "rows": 3, "dim": 0.42, "blur": 26, "theme": "dark", "background": "wallpaper" },
  "behavior": { "openOnSingleClick": true },
  "app": { "launchAtLogin": false, "firstRunDone": true }
}
```

- 瓦片位置拖动自动写回；设置页保存时统一重编号 `t1..tN`。
- `overlay.dim`（0.15–0.7 压暗）、`overlay.blur`（8–48px）、`overlay.background` 为背景方案。
- 手改配置损坏会备份成 `config.broken-<时间>.json` 并回默认值；数值越界自动夹取。

## 背景模式

优先级：环境变量 `PF_BG` > 设置页选择 > 默认。

| 值 | 做法 | 适用 |
|---|---|---|
| `wallpaper`（默认） | 读当前壁纸 → 缩 640 宽 → 渲染层 CSS 模糊 + 压暗 | 干净、不采集窗口内容、零延迟 |
| `capture` | 抓当前桌面缩略图（会把开着的窗口一起模糊），缓存预热后打开 ≤150ms | 想要「模糊当前桌面」的实时感 |
| `acrylic` | DWM acrylic 实时模糊 | 实验；Win11 浅色主题下偏奶白 |

## 目录结构

```
D:\deskTop\phoneS\
├─ package.json / .npmrc / .gitignore
├─ assets\                 icon.ico / icon.png（托盘与窗口图标）
├─ docs\                   开发计划 + P1~P4 进展
├─ scripts\                诊断 / E2E / 截图辅助脚本
├─ shots\                  截图产物（gitignore）
├─ src\
│  ├─ main\
│  │  ├─ main.js           生命周期、多瓦片、托盘、设置、自启、IPC
│  │  ├─ windows\          tile / overlay / backdrop / settings 窗口
│  │  └─ services\         config / folder / icons / fsops / settings / background / logger
│  ├─ preload\             contextBridge 最小 API
│  └─ renderer\            tile / overlay / backdrop / settings 页面
└─ tests\unit\run.js       单元测试
```

## 已知限制

- 瓦片是普通窗口：会被其他窗口盖住；Win+D 显示桌面时会被一起藏起来（P6「真占格」解决）
- 托盘「显示/隐藏瓦片」不持久化；拖出一次只能一个文件；拖入是移动语义（不复制）
- 多显示器未适配（瓦片/浮层/设置均按主屏）；瓦片大小是全局设置
- 未打包；未签名 exe 会有 SmartScreen 提示（P5 处理）
- 空闲内存约 400MB（5 个 Electron 进程，含预创建浮层）；P5 优化
