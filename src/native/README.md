# `treeland-activate`：treeland 原生窗口激活 helper

## 为什么需要它

Obsidian 在前台时，treeland（Deepin 25 的 Wayland 合成器）**不会**因为 X11 的请求把焦点交给 XWayland 客户端：

- `xdotool windowactivate` 返回 0，但 `_NET_ACTIVE_WINDOW` 不变、X 焦点回 `PointerRoot`；
- 发送 EWMH `_NET_ACTIVE_WINDOW` client message 同样被忽略；
- `xdg-open teleai-cowork://`、二次运行 `/usr/bin/teleagent` 都抬不起窗口（后者还会撞 `SingletonLock`）；
- `xdotool windowraise` 只改 X 侧堆叠请求，合成器不跟随。

真正可写的通道是 treeland 自己的 `treeland_foreign_toplevel_manager_v1`（DDE 版；wlroots 的
`zwlr_foreign_toplevel_manager_v1` 在 treeland 上只保证状态可读、写请求被忽略）。这个 helper 就是
最小实现：按标题子串找到 toplevel，对它的 seat 发 `activate`。

## 构建与用法

```bash
node scripts/build-native.mjs          # 产物 bin/treeland-activate（已在 .gitignore，不入库）
./bin/treeland-activate "TeleAgent 星辰"   # 成功 exit 0；找不到窗口 exit 2；协议不可用 exit 1
```

依赖：`wayland-client` 开发头（`pkg-config --cflags --libs wayland-client` 可用）+ C 编译器。
没有这些条件时 `build-native.mjs` **跳过**并以 0 退出——helper 是可选的，插件主功能不依赖它。

安装时 `scripts/install.mjs` 会把已构建的 helper 复制到 `<vault>/.obsidian/plugins/agent-deck/bin/`；
运行时按「环境变量 `AGENT_DECK_TREELAND_ACTIVATE` → PATH 上的 `treeland-activate` → 插件目录 `bin/`」
探测，找不到就降级为「请先手动切到 TeleAgent 再派发」的提示，绝不盲点盲打。

## 来源与许可

- `treeland-foreign-toplevel-manager-v1-client-protocol.h` / `…-protocol.c` 由 `wayland-scanner` 从
  Deepin/treeland 的协议 XML 生成（生成器版本见文件头）。协议代码版权：
  `SPDX-FileCopyrightText: 2024 UnionTech Software Technology Co., Ltd.`，`SPDX-License-Identifier: MIT`
  （见 `…-protocol.c` 头部）。本项目只做调用与打包，未修改协议代码。
- `treeland-activate.c` 为本项目自有代码（Apache-2.0，随仓库 LICENSE）。

重新生成（协议 XML 来自 treeland 仓库）：

```bash
wayland-scanner client-header treeland-foreign-toplevel-manager-v1.xml treeland-foreign-toplevel-manager-v1-client-protocol.h
wayland-scanner private-code  treeland-foreign-toplevel-manager-v1.xml treeland-foreign-toplevel-manager-v1-protocol.c
```

## 边界

- 只做「激活」，不改窗口状态、不启动应用、不发网络请求。
- 仅 Deepin/treeland 有效；其它合成器上协议不可用（exit 1），调用方按缺失降级。
