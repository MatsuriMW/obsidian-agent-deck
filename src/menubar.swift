// Agent Deck menu bar helper.
// Compiled at runtime from the plugin with:
//   swiftc -O -swift-version 5 -framework AppKit -framework SwiftUI -o AgentDeckMenuBar AgentDeckMenuBar.swift
// It reads a JSON snapshot written by the Obsidian plugin and shows a small
// status item with a detailed popover. It never talks to the network.

import AppKit
import SwiftUI
import Foundation
import Darwin

struct MenuSession: Decodable, Identifiable {
    let id: String
    let agent: String
    let agentName: String
    let color: String
    let glyph: String
    let title: String
    let detail: String
    let state: String
    let stateLabel: String
    let primary: Bool
    let url: String?
    let copy: String?
}

struct MenuAgent: Decodable, Identifiable {
    let id: String
    let short: String
    let name: String
    let color: String
    let glyph: String
    let running: Int
    let waiting: Int
    let primary: Bool
}

struct MenuState: Decodable {
    let updatedAt: Double
    let short: String
    let summary: String
    let running: Int
    let waiting: Int
    let sessions: [MenuSession]
    let agents: [MenuAgent]?

    static let empty = MenuState(updatedAt: 0, short: "Agent Deck", summary: "等待 Agent Deck…", running: 0, waiting: 0, sessions: [], agents: [])
}

final class MenuModel: ObservableObject {
    @Published var state: MenuState = .empty
    let statePath: String
    let parentPid: Int32
    var timer: Timer?
    var onUpdate: (() -> Void)?

    init(statePath: String, parentPid: Int32) {
        self.statePath = statePath
        self.parentPid = parentPid
    }

    func start() {
        reload()
        let t = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func tick() {
        if parentPid > 0 && kill(parentPid, 0) != 0 {
            NSApp.terminate(nil)
            return
        }
        reload()
    }

    func reload() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
              let next = try? JSONDecoder().decode(MenuState.self, from: data) else { return }
        if next.updatedAt != state.updatedAt {
            state = next
            onUpdate?()
        }
    }
}

func openURL(_ string: String?) {
    guard let s = string, let url = URL(string: s) else { return }
    NSWorkspace.shared.open(url)
}

func openSession(_ session: MenuSession) {
    if let copy = session.copy, !copy.isEmpty {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(copy, forType: .string)
    }
    if let url = session.url, !url.isEmpty {
        openURL(url)
    }
}

func stateColor(_ state: String) -> Color {
    switch state {
    case "run": return .green
    case "wait", "needs-approval": return .orange
    case "error", "limit": return .red
    default: return .secondary
    }
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xff) / 255.0
        let g = Double((value >> 8) & 0xff) / 255.0
        let b = Double(value & 0xff) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

struct SessionRowView: View {
    let session: MenuSession

    var body: some View {
        Button(action: { openSession(session) }) {
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(Color(hex: session.color))
                    .frame(width: 7, height: 7)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(session.title)
                            .font(.system(size: 11.5, weight: .semibold))
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text(session.stateLabel)
                            .font(.system(size: 8.5, weight: .bold))
                            .foregroundColor(stateColor(session.state))
                    }
                    Text(session.detail)
                        .font(.system(size: 9.5))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 8.5))
                    .foregroundColor(.secondary)
                    .padding(.top, 3)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.07)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct DeckView: View {
    @ObservedObject var model: MenuModel

    @ViewBuilder
    func section(_ title: String, _ rows: [MenuSession]) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 8.5, weight: .bold))
                .foregroundColor(.secondary)
                .textCase(.uppercase)
            Spacer()
            Text("\(rows.count)")
                .font(.system(size: 8.5, weight: .semibold))
                .foregroundColor(.secondary)
        }
        .padding(.top, 4)
        .padding(.horizontal, 2)
        ForEach(rows) { s in
            SessionRowView(session: s)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(LinearGradient(colors: [Color(red: 0.42, green: 0.48, blue: 1.0), Color(red: 0.62, green: 0.36, blue: 1.0)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Agent Deck")
                        .font(.system(size: 13, weight: .bold))
                    Text(model.state.summary)
                        .font(.system(size: 9.5))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text("\(model.state.running) 在跑")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.green)
                    if model.state.waiting > 0 {
                        Text("\(model.state.waiting) 等你")
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundColor(.orange)
                    }
                }
            }
            if let agents = model.state.agents, !agents.isEmpty {
                HStack(spacing: 5) {
                    ForEach(agents) { a in
                        HStack(spacing: 3) {
                            Circle().fill(Color(hex: a.color)).frame(width: 5, height: 5)
                            Text(a.short)
                                .font(.system(size: 8.5, weight: a.primary ? .semibold : .regular))
                                .foregroundColor(a.primary ? .primary : .secondary)
                            Text("\(a.running)")
                                .font(.system(size: 8.5, weight: .bold))
                                .foregroundColor(a.running > 0 ? .green : .secondary)
                            if a.waiting > 0 {
                                Text("· \(a.waiting) 等")
                                    .font(.system(size: 8))
                                    .foregroundColor(.orange)
                            }
                        }
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.secondary.opacity(a.primary ? 0.12 : 0.06)))
                    }
                    Spacer()
                }
                .padding(.top, 7)
            }
            Divider().padding(.vertical, 9)
            if model.state.sessions.isEmpty {
                VStack(spacing: 4) {
                    Text("现在没有要显示的会话")
                        .font(.system(size: 11, weight: .semibold))
                    Text("主力 Agent 的会话会留在这里；其它 Agent 只在正在运行时出现。")
                        .font(.system(size: 9.5))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 22)
            } else {
                let primary = model.state.sessions.filter { $0.primary }
                let others = model.state.sessions.filter { !$0.primary }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 5) {
                        if !primary.isEmpty {
                            section("主力 · 全量追踪", primary)
                        }
                        if !others.isEmpty {
                            section("其它 Agent · 只在跑", others)
                        }
                    }
                }
                .frame(maxHeight: 430)
            }
            Divider().padding(.vertical, 9)
            Text("主力全量追踪 · 其它 Agent 只在运行中列出")
                .font(.system(size: 8))
                .foregroundColor(.secondary)
                .padding(.bottom, 7)
            HStack(spacing: 8) {
                Button("打开面板") { openURL("obsidian://agent-deck") }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                Button("重新扫描") { openURL("obsidian://agent-deck?do=scan") }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                Spacer()
                Button("隐藏") { openURL("obsidian://agent-deck?do=hide") }
                    .buttonStyle(.plain)
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }
        }
        .padding(14)
        .frame(width: 390)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var model: MenuModel!
    var statePath: String = NSString(string: "~/.agent-deck/menubar.json").expandingTildeInPath
    var parentPid: Int32 = 0
    var preview = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--state"), i + 1 < args.count { statePath = args[i + 1] }
        if let i = args.firstIndex(of: "--parent"), i + 1 < args.count { parentPid = Int32(args[i + 1]) ?? 0 }
        preview = args.contains("--preview")
        if let i = args.firstIndex(of: "--pidfile"), i + 1 < args.count {
            try? "\(getpid())".write(toFile: args[i + 1], atomically: true, encoding: .utf8)
        }

        model = MenuModel(statePath: statePath, parentPid: parentPid)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Agent Deck")
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
            button.title = " Agent Deck"
            button.font = NSFont.systemFont(ofSize: 11, weight: .medium)
            button.target = self
            button.action = #selector(togglePopover)
        }

        let host = NSHostingController(rootView: DeckView(model: model))
        popover = NSPopover()
        popover.contentViewController = host
        popover.behavior = .transient
        popover.animates = true
        popover.contentSize = NSSize(width: 390, height: 470)

        model.onUpdate = { [weak self] in self?.refresh() }
        model.start()
        refresh()
        if preview {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                self?.showPopover()
            }
        }
    }

    func refresh() {
        let short = model.state.short.trimmingCharacters(in: .whitespacesAndNewlines)
        statusItem.button?.title = short.isEmpty ? " Agent Deck" : " " + short
        if popover != nil {
            let n = min(model.state.sessions.count, 8)
            let h = max(240, min(640, 206 + CGFloat(n) * 54 + (n > 0 ? 18 : 0)))
            popover.contentSize = NSSize(width: 390, height: h)
        }
    }

    func showPopover() {
        guard let button = statusItem.button else { return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func togglePopover() {
        if popover.isShown {
            popover.performClose(nil)
        } else {
            showPopover()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
