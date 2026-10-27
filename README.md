# PhoneFolder

Windows 桌面「手机文件夹」：桌面上常驻一格瓦片，单击后整屏压暗、壁纸模糊，瓦片原地放大成毛玻璃网格；点面板外 / Esc 收起。背后绑定一个真实文件夹（后续支持多个）。

交互对标付费软件 DeskFolders，本项目免费自研。定位：不替代资源管理器，只在桌面上加一层「文件夹入口 + 展开层」。

## 当前进度

| 阶段 | 状态 | 说明 |
|---|---|---|
| P0 脚手架 | ✅ 完成 | pnpm + Electron 43.3.0，main/preload/renderer 分层，`pnpm shot` 截图 |
| P1 视觉原型 | ✅ 完成 | 瓦片 UI、全屏浮层、壁纸模糊、开合动画 |
| P2 真实内容 | ✅ 完成 | 真实文件夹扫描、256px 缩略图、3×3 分页、点击打开、右键菜单、fs.watch 刷新、空态/错误态 |
| P3 拖放 | ✅ 完成 | 拖入移入（重名 (n)、跨盘回退、跳过已在内）、单文件拖出、拖入高亮/toast |
| P4 系统集成 | ⬜ 待开始 | 托盘、设置页、开机自启、多瓦片 |
| P5 打磨打包 | ⬜ 待开始 | 动画调参、内存优化、便携版打包 |

- 开发计划：[docs/开发计划.md](docs/开发计划.md)
- P1 进展、实测数据与踩坑记录：[docs/P1-进展.md](docs/P1-进展.md)
- P2 进展（真实内容/图标/分页）：[docs/P2-进展.md](docs/P2-进展.md)
- P3 进展（拖入/拖出）：[docs/P3-进展.md](docs/P3-进展.md)

## 运行

```powershell
pnpm install    # 首次
pnpm start      # 启动，瓦片出现在主屏右上角
pnpm shot       # 自动截图到 shots/（瓦片态 → 展开中 → 展开态 → 收起后）
```

> 注意：本机 DSH 终端里 `ELECTRON_RUN_AS_NODE=1`，启动前需清掉该环境变量，
> 否则 Electron 会以 Node 模式运行：
> `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; pnpm start`

## 交互（当前原型）

- **单击瓦片**：展开浮层；再点瓦片位置 / 点面板外 / 按 Esc：收起
- **拖动瓦片**：移动到任意位置，松开后写回配置
- **右键瓦片**：菜单（展开文件夹 / 打开绑定文件夹 / 重新扫描 / 退出 PhoneFolder）——P4 之前的临时退出方式
- **浮层内**：显示绑定文件夹真实内容；滚轮 / ←→ / 左右滑动翻页，底部圆点可点击
- **单击条目**：打开文件或文件夹（资源管理器），浮层自动收起
- **右键条目**：菜单（打开 / 在资源管理器中显示 / 复制路径）
- **文件变化**：文件夹里有增删改（300ms 去抖）会自动刷新浮层和瓦片预览
- **拖入**：从资源管理器把文件/文件夹拖到瓦片或浮层任意位置 → 移入绑定文件夹（高亮 + 「松手移入」提示 + 「已移入 N 项」toast；同名自动加 `(1)`；已在文件夹内的会跳过）
- **拖出**：把浮层里的条目拖到资源管理器/桌面（Electron 原生拖拽，单文件限制）
- 空文件夹、文件夹被删/无权限都有中文提示

## 测试

```powershell
pnpm test                        # 排序/过滤/移入逻辑单测
node scripts/e2e-drop.js         # E2E：拖入链路（CDP 调用真实 IPC）
```

## 配置

`%APPDATA%\phone-folder\config.json`（v2）：

```json
{
  "version": 2,
  "tiles": [{ "id": "t1", "folder": "D:\\deskTop", "x": 1812, "y": 24, "size": 84 }],
  "overlay": { "columns": 3, "rows": 3, "dim": 0.42, "theme": "dark", "background": "auto" }
}
```

位置由拖动自动写回；配置损坏会备份成 `config.broken-<时间>.json` 并回默认值。

## 背景模式（环境变量 `PF_BG`）

| 值 | 做法 | 适用 |
|---|---|---|
| `wallpaper`（默认） | 读当前壁纸 → 缩到 640 宽 → 渲染层 CSS 模糊 + 压暗 | 干净、不采集窗口内容、零延迟 |
| `capture` | 抓当前桌面缩略图（会把打开着的窗口一起模糊），缓存预热后打开 ≤150ms | 想要「模糊当前桌面」的实时感 |
| `acrylic` | DWM acrylic 实时模糊 | 实验；Win11 浅色主题下偏奶白 |

示例：`$env:PF_BG='capture'; pnpm start`

## 目录结构

```
D:\deskTop\phoneS\
├─ package.json / .npmrc / .gitignore
├─ docs\                  开发计划 + P1/P2/P3 进展
├─ scripts\               诊断脚本 + E2E
├─ shots\                 截图产物（gitignore）
├─ src\
│  ├─ main\               主进程：窗口、IPC、配置、背景
│  ├─ preload\            contextBridge 最小 API
│  └─ renderer\           tile / overlay / backdrop 三套页面
└─ tests\                 单元测试（P2 起）
```

## 已知限制

- 瓦片是普通窗口：会被其他窗口盖住；Win+D 显示桌面时会被一起藏起来（P6「真占格」解决）
- 托盘、开机自启、多瓦片未实现（P4）；拖出一次只能一个文件；拖入是移动语义（不复制）
- 多显示器未适配（当前只做主屏）
- 未打包；未签名 exe 会有 SmartScreen 提示（P5 处理）
- 空闲内存约 400MB（5 个 Electron 进程，含预创建浮层）；P5 再优化


