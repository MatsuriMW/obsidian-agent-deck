// Agent Deck menu bar helper.
// Compiled at runtime from the plugin with:
//   swiftc -O -swift-version 5 -framework AppKit -framework SwiftUI -o AgentDeckMenuBar AgentDeckMenuBar.swift
// It reads a JSON snapshot written by the Obsidian plugin and shows a small
// status item with a detailed panel. It never talks to the network.
//
// The panel is a borderless NSPanel with opaque, solid surfaces. It deliberately
// avoids NSPopover / NSVisualEffectView: macOS 26 renders those with a strong
// glass material, which made the old card list washed out and hard to read.

import AppKit
import Carbon
import QuartzCore
import SwiftUI
import Foundation
import Darwin

let lucideWandSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>
"""

let lucideArrowSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
"""

let lucidePinSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
"""

func lucideImage(_ svg: String, _ size: CGFloat) -> NSImage? {
    guard let data = svg.data(using: .utf8), let image = NSImage(data: data) else { return nil }
    image.isTemplate = true
    image.size = NSSize(width: size, height: size)
    return image
}

// The exact icons TODOseq puts before a task keyword. Paths and stroke widths
// are copied from its local patch so the menu bar reads as the same language:
// TODO = dashed circle, DOING = loader-circle (spins), DONE = circle-check,
// PAUSED = pause, WAITING = hourglass, NEEDOK = hand, ERRORED = badge-alert,
// HITLIMIT = gauge.
enum TsqIcons {
    private static func wrap(_ body: String) -> String {
        """
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\(body)</svg>
        """
    }

    static let todo = wrap("""
    <path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/>
    """)

    static let doing = wrap(#"<path d="M21 12a9 9 0 1 1-6.219-8.56"/>"#)

    static let done = wrap(#"<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>"#)

    static let paused = wrap(#"<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>"#)

    static let waiting = wrap("""
    <path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
    """)

    static let needok = wrap("""
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    """)

    static let errored = wrap("""
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
    """)

    static let hitlimit = wrap(#"<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>"#)
}

// MARK: - Snapshot

struct MenuSession: Decodable, Identifiable {
    let id: String
    let sid: String?
    let pinned: Bool?
    let agent: String
    let agentName: String
    let agentShort: String?
    let color: String
    let glyph: String
    let title: String
    let detail: String
    let state: String
    let stateLabel: String
    let primary: Bool
    let url: String?
    let copy: String?
    let keyword: String?
    let keywordLabel: String?
    let project: String?
    let step: String?
    let ago: String?

    var resolvedSid: String {
        if let sid = sid, !sid.isEmpty { return sid }
        if let colon = id.firstIndex(of: ":") {
            return String(id[id.index(after: colon)...])
        }
        return id
    }

    var isPinned: Bool {
        pinned == true
    }

    var keywordCode: String {
        if let keyword = keyword, !keyword.isEmpty { return keyword }
        return DeckKeywords.code(for: state)
    }

    var keywordZh: String {
        if let label = keywordLabel, !label.isEmpty { return label }
        return DeckKeywords.style(for: keywordCode).zh
    }

    // WorkBuddy sometimes stores a bare XML-wrapped tool prompt as the title.
    var displayTitle: String {
        var text = title
        for tag in ["<user_query>", "</user_query>", "<user_request>", "</user_request>"] {
            text = text.replacingOccurrences(of: tag, with: "")
        }
        if let open = text.firstIndex(of: "<"), let close = text[open...].firstIndex(of: ">") {
            text.removeSubrange(open...close)
        }
        text = text.replacingOccurrences(of: "\n", with: " ")
        text = text.split(separator: " ").joined(separator: " ")
        return text.isEmpty ? title : text
    }

    var hasStructuredMeta: Bool {
        (project?.isEmpty == false) || (step?.isEmpty == false) || (ago?.isEmpty == false)
    }

    var shortAgent: String {
        if let s = agentShort, !s.isEmpty { return s }
        switch agent {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "workbuddy": return "WorkBuddy"
        case "dsh": return "DSH"
        case "hermes": return "Hermes"
        case "minimax": return "MiniMax"
        case "qwenwork": return "千问办公"
        case "cursor": return "Cursor"
        case "trae": return "Trae"
        case "grokbot": return "Grok Bot"
        case "t3code": return "T3 Code"
        case "cindy": return "Cindy"
        case "orca": return "Orca"
        case "muse": return "Muse"
        case "kimicode": return "Kimi Code"
        case "doubaowork": return "豆包工作"
        case "gemini": return "Gemini CLI"
        case "teleagent": return "TeleAgent"
        default: return agentName
        }
    }
}

struct MenuGroup: Decodable, Identifiable {
    let id: String
    let name: String
    let tone: String?
    let attention: Bool?
    let running: Int?
    let waiting: Int?
    let issue: Int?
    let agents: [String]?
    let sessions: [MenuSession]
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
    let today: String?
}

/// One number in the panel header (label above, value below). The plugin decides which ones to send.
struct MenuStat: Decodable {
    let label: String
    let value: String
}

// MARK: - Localized labels

/// The plugin sends a `labels` map (Chinese source string -> text in the app
/// language) with every snapshot. Anything missing keeps the Chinese literal
/// below, so an older snapshot or an untranslated string still renders.
enum DeckLabels {
    static var table: [String: String] = [:]
}

/// Localized UI text. `vars` fills `{name}` placeholders so a translated string
/// can put the numbers where English needs them.
func L(_ zh: String, _ vars: [String: String] = [:]) -> String {
    var text = DeckLabels.table[zh] ?? zh
    for (name, value) in vars {
        text = text.replacingOccurrences(of: "{\(name)}", with: value)
    }
    return text
}

struct MenuState: Decodable {
    let updatedAt: Double
    let short: String
    let summary: String
    let usage: String?
    let hotkey: String?
    let running: Int
    let waiting: Int
    let nowGroupBy: String?
    let projectGroups: [MenuGroup]?
    let statusGroups: [MenuGroup]?
    let sessions: [MenuSession]
    let agents: [MenuAgent]?
    let stats: [MenuStat]?
    /// Chinese source string -> localized text, filled by the plugin.
    let labels: [String: String]?

    static var empty: MenuState {
        MenuState(updatedAt: 0, short: "Agent Deck", summary: L("等待 Agent Deck…"), usage: nil, hotkey: nil, running: 0, waiting: 0, nowGroupBy: "project", projectGroups: nil, statusGroups: nil, sessions: [], agents: [], stats: nil, labels: nil)
    }

    var needsApproval: Int {
        sessions.filter { $0.state == "needs-approval" }.count
    }

    var usageLine: String {
        if let usage = usage, !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return usage
        }
        let parts = summary
            .split(separator: "·")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.contains(L("在跑")) && !$0.contains(L("等你")) }
        if parts.isEmpty {
            return summary.isEmpty ? L("等待 Agent Deck…") : summary
        }
        return parts.joined(separator: " · ")
    }
}

final class MenuModel: ObservableObject {
    @Published var state: MenuState = .empty
    @Published var panelVisible = false
    @Published var panelPinned: Bool
    @Published var optimisticPins: [String: (pinned: Bool, at: Double)] = [:]
    @Published var optimisticGroupBy: (mode: String, at: Double)? = nil
    @Published var collapsedGroups: [String: Set<String>] = [:]
    let statePath: String
    let showPath: String
    let cmdDir: String
    let parentPid: Int32
    var timer: Timer?
    var onUpdate: (() -> Void)?
    var onShowRequest: (() -> Void)?
    var onPinModeChanged: (() -> Void)?
    private var lastShowAt = Date().timeIntervalSince1970
    private var lastStateMtime: Date?

    private static let panelPinnedKey = "AgentDeckPanelPinned"
    private static let pinnedXKey = "AgentDeckPinnedX"
    private static let pinnedYKey = "AgentDeckPinnedY"
    private static let hasPinnedOriginKey = "AgentDeckHasPinnedOrigin"

    init(statePath: String, parentPid: Int32) {
        self.statePath = statePath
        let baseDir = URL(fileURLWithPath: statePath).deletingLastPathComponent()
        self.showPath = baseDir.appendingPathComponent("show-panel").path
        self.cmdDir = baseDir.appendingPathComponent("cmds").path
        self.parentPid = parentPid
        self.panelPinned = UserDefaults.standard.bool(forKey: Self.panelPinnedKey)
    }

    var savedPinnedOrigin: NSPoint? {
        guard UserDefaults.standard.bool(forKey: Self.hasPinnedOriginKey) else { return nil }
        return NSPoint(
            x: UserDefaults.standard.double(forKey: Self.pinnedXKey),
            y: UserDefaults.standard.double(forKey: Self.pinnedYKey)
        )
    }

    func savePinnedOrigin(_ origin: NSPoint) {
        UserDefaults.standard.set(origin.x, forKey: Self.pinnedXKey)
        UserDefaults.standard.set(origin.y, forKey: Self.pinnedYKey)
        UserDefaults.standard.set(true, forKey: Self.hasPinnedOriginKey)
    }

    func togglePanelPin() {
        panelPinned.toggle()
        UserDefaults.standard.set(panelPinned, forKey: Self.panelPinnedKey)
        onPinModeChanged?()
    }

    func isSessionPinned(_ session: MenuSession) -> Bool {
        if let entry = optimisticPins[session.resolvedSid] { return entry.pinned }
        return session.isPinned
    }

    var activeGroupBy: String {
        let mode = optimisticGroupBy?.mode ?? state.nowGroupBy ?? "project"
        return (mode == "project" || mode == "status" || mode == "flat") ? mode : "project"
    }

    func activeGroups() -> [MenuGroup] {
        switch activeGroupBy {
        case "project": return state.projectGroups ?? []
        case "status": return state.statusGroups ?? []
        default: return []
        }
    }

    func orderedFlatSessions() -> [MenuSession] {
        let pinned = state.sessions.filter { isSessionPinned($0) }
        let rest = state.sessions.filter { !isSessionPinned($0) }
        return pinned + rest
    }

    var visibleSessionCount: Int {
        switch activeGroupBy {
        case "flat":
            return state.sessions.count
        default:
            let groups = activeGroups()
            if !groups.isEmpty {
                return groups.reduce(0) { $0 + $1.sessions.count }
            }
            return (state.projectGroups == nil && state.statusGroups == nil) ? state.sessions.count : 0
        }
    }

    func isGroupCollapsed(_ mode: String, _ id: String) -> Bool {
        collapsedGroups[mode]?.contains(id) == true
    }

    func toggleGroupCollapsed(_ mode: String, _ id: String) {
        var set = collapsedGroups[mode] ?? []
        if set.contains(id) { set.remove(id) } else { set.insert(id) }
        collapsedGroups[mode] = set
        onUpdate?()
    }

    func setGroupBy(_ mode: String) {
        guard mode == "project" || mode == "status" || mode == "flat", mode != activeGroupBy else { return }
        let nowMs = Date().timeIntervalSince1970 * 1000
        optimisticGroupBy = (mode, nowMs)
        onUpdate?()
        sendCommand(["action": "setNowGroupBy", "mode": mode], stampMs: nowMs)
    }

    func togglePinSession(_ session: MenuSession) {
        let sid = session.resolvedSid
        let next = !isSessionPinned(session)
        let nowMs = Date().timeIntervalSince1970 * 1000
        optimisticPins[sid] = (next, nowMs)
        onUpdate?()
        sendCommand(["action": "togglePin", "sid": sid, "pinned": next], stampMs: nowMs)
    }

    private func sendCommand(_ payload: [String: Any], stampMs: Double) {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: cmdDir, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            let name = "\(Int64(stampMs))-\(UUID().uuidString.prefix(8)).json"
            let url = URL(fileURLWithPath: cmdDir).appendingPathComponent(name)
            try? data.write(to: url, options: .atomic)
        }
    }

    func start() {
        lastShowAt = Date().timeIntervalSince1970
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
        checkShowRequest()
    }

    func checkShowRequest() {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: showPath),
              let date = attributes[.modificationDate] as? Date else { return }
        let stamp = date.timeIntervalSince1970
        if stamp > lastShowAt {
            lastShowAt = stamp
            onShowRequest?()
        }
    }

    func reload() {
        // 文件没动就不读不解码；插件只在状态变了时才重写它
        let mtime = (try? FileManager.default.attributesOfItem(atPath: statePath))?[.modificationDate] as? Date
        if let mtime = mtime, mtime == lastStateMtime { return }
        lastStateMtime = mtime
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
              let next = try? JSONDecoder().decode(MenuState.self, from: data) else { return }
        if next.updatedAt != state.updatedAt {
            DeckLabels.table = next.labels ?? [:]
            state = next
            for (sid, entry) in optimisticPins {
                let matched = next.sessions.first(where: { $0.resolvedSid == sid })?.isPinned == entry.pinned
                if matched || next.updatedAt > entry.at + 4000 {
                    optimisticPins.removeValue(forKey: sid)
                }
            }
            if let opt = optimisticGroupBy, next.nowGroupBy == opt.mode || next.updatedAt > opt.at + 4000 {
                optimisticGroupBy = nil
            }
            onUpdate?()
        }
    }
}

// MARK: - Actions

extension Notification.Name {
    static let agentDeckDismiss = Notification.Name("AgentDeckDismissPanel")
}

func openURL(_ string: String?) {
    guard let s = string, let url = URL(string: s) else { return }
    NSWorkspace.shared.open(url)
}

func dismissThen(_ action: () -> Void) {
    action()
    NotificationCenter.default.post(name: .agentDeckDismiss, object: nil)
}

func adOpen(_ string: String) {
    dismissThen { openURL(string) }
}

func openSession(_ session: MenuSession) {
    dismissThen {
        if let copy = session.copy, !copy.isEmpty {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(copy, forType: .string)
        }
        if let url = session.url, !url.isEmpty {
            openURL(url)
        }
    }
}

// MARK: - Palette

extension NSColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let r = CGFloat((value >> 16) & 0xff) / 255.0
        let g = CGFloat((value >> 8) & 0xff) / 255.0
        let b = CGFloat(value & 0xff) / 255.0
        self.init(srgbRed: r, green: g, blue: b, alpha: 1)
    }
}

extension Color {
    init(hex: String) {
        self.init(nsColor: NSColor(hex: hex))
    }

    /// Opaque colour that still follows light / dark appearance. The solid
    /// surfaces are the whole point here: no material, no vibrancy.
    static func solid(_ light: String, _ dark: String) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

enum DeckPalette {
    // Same language as the plugin panel in Obsidian (styles.css): warm neutral
    // surfaces, and the one accent is the plugin's muted --ad-accent (#746d94).
    // No saturated violet: next to the Obsidian window it read as a different app.
    static let panel = Color.solid("#F7F6F3", "#1A1917")
    static let panelTint = Color.solid("#F7F6F3", "#1A1917").opacity(0.56)
    static let header = Color.solid("#F0EEEA", "#201F1D")
    static let headerTint = Color.solid("#F0EEEA", "#201F1D").opacity(0.40)
    static let panelBorder = Color.solid("#DDD9D2", "#3A3835")

    static let card = Color.solid("#FFFFFF", "#252421").opacity(0.76)
    static let cardHover = Color.solid("#FDFCFA", "#2C2A27").opacity(0.90)
    static let cardBorder = Color.solid("#E6E3DD", "#3A3835").opacity(0.85)
    static let cardBorderHover = Color.solid("#CCC7BE", "#59554F")

    static let ink = Color.solid("#1F1E1C", "#F4F2EE")
    static let secondary = Color.solid("#625F59", "#B6B2AA")
    static let tertiary = Color.solid("#89857D", "#8D8980")
    static let divider = Color.solid("#E5E2DB", "#33312E")
    static let pill = Color.solid("#EAE7E1", "#2E2C29")
    static let brand = Color.solid("#746D94", "#9C95BD")
}

// MARK: - TODOseq keywords

/// The keyword palette is lifted from the TODOseq plugin's local patch:
/// https://github.com/.../todoseq/styles.css ("关键词按状态上色").
/// Accent is the original colour; ink is a darkened variant for chip text so
/// small labels keep a readable contrast on the pale solid chip background.
struct KeywordStyle {
    let code: String
    /// Chinese source label; the displayed text runs through L() so the panel
    /// follows the app language.
    let key: String
    var zh: String { L(key) }
    let accent: Color
    let ink: Color
    let tint: Color
    let icon: String
    let spins: Bool
}

enum DeckKeywords {
    static let doing = KeywordStyle(
        code: "DOING", key: "在跑",
        accent: .solid("#C8635F", "#FF938B"),
        ink: .solid("#A34C48", "#FFB3AC"),
        tint: .solid("#F9E7E5", "#37211F"),
        icon: TsqIcons.doing, spins: true
    )

    static let needok = KeywordStyle(
        code: "NEEDOK?", key: "等你",
        accent: .solid("#BF7A45", "#F2A66B"),
        ink: .solid("#96582B", "#FFC79A"),
        tint: .solid("#FBEDE1", "#3A281C"),
        icon: TsqIcons.needok, spins: false
    )

    static let waiting = KeywordStyle(
        code: "WAITING", key: "等你",
        accent: .solid("#8F7FB6", "#BFAEEA"),
        ink: .solid("#6A5B92", "#D9CEFF"),
        tint: .solid("#F0EBF8", "#2A2438"),
        icon: TsqIcons.waiting, spins: false
    )

    static let paused = KeywordStyle(
        code: "PAUSED", key: "安静",
        accent: .solid("#B39A3E", "#E4CB6A"),
        ink: .solid("#846F22", "#F2DF9B"),
        tint: .solid("#F7F0D9", "#332C18"),
        icon: TsqIcons.paused, spins: false
    )

    static let errored = KeywordStyle(
        code: "ERRORED", key: "出错",
        accent: .solid("#93606B", "#E18C99"),
        ink: .solid("#70414B", "#F5B5BE"),
        tint: .solid("#F5E7E9", "#37222A"),
        icon: TsqIcons.errored, spins: false
    )

    static let hitlimit = KeywordStyle(
        code: "HITLIMIT!", key: "限额",
        accent: .solid("#8A5A8C", "#CE93D2"),
        ink: .solid("#673A69", "#E8B9EB"),
        tint: .solid("#F4E8F4", "#332236"),
        icon: TsqIcons.hitlimit, spins: false
    )

    static let done = KeywordStyle(
        code: "DONE", key: "完成",
        accent: .solid("#629C7F", "#83C9A5"),
        ink: .solid("#43705A", "#B1E5C9"),
        tint: .solid("#E8F3EC", "#1D3328"),
        icon: TsqIcons.done, spins: false
    )

    static let later = KeywordStyle(
        code: "LATER", key: "最近",
        accent: .solid("#5C86B4", "#8FB8E8"),
        ink: .solid("#40658D", "#C2DFFF"),
        tint: .solid("#E9F0F9", "#1E2A38"),
        icon: TsqIcons.todo, spins: false
    )

    static let todo = KeywordStyle(
        code: "TODO", key: "空闲",
        accent: .solid("#5C86B4", "#8FB8E8"),
        ink: .solid("#40658D", "#C2DFFF"),
        tint: .solid("#E9F0F9", "#1E2A38"),
        icon: TsqIcons.todo, spins: false
    )

    static func code(for state: String) -> String {
        switch state {
        case "run": return "DOING"
        case "needs-approval": return "NEEDOK"
        case "wait": return "WAITING"
        case "quiet": return "PAUSED"
        case "error": return "ERRORED"
        case "limit": return "HITLIMIT"
        case "done": return "DONE"
        case "recent": return "LATER"
        default: return "TODO"
        }
    }

    static func style(for code: String) -> KeywordStyle {
        let base = code
            .uppercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "?! "))
        switch base {
        case "DOING", "NOW", "IN-PROGRESS": return doing
        case "NEEDOK": return needok
        case "WAITING", "WAIT": return waiting
        case "PAUSED", "SUSPENDED": return paused
        case "ERRORED", "FAILED": return errored
        case "HITLIMIT": return hitlimit
        case "DONE": return done
        case "LATER", "DELEGATED", "QUEUED", "TOREVIEW": return later
        case "TODO": return todo
        default: return todo
        }
    }
}

// MARK: - Keyword glyph

private struct DeckPanelVisibleKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    var deckPanelVisible: Bool {
        get { self[DeckPanelVisibleKey.self] }
        set { self[DeckPanelVisibleKey.self] = newValue }
    }
}

/// Renders the same SVG TODOseq puts in front of a keyword. DOING keeps
/// spinning, but only while the panel is actually on screen. The rotation runs
/// on a CALayer so SwiftUI is not re-rendered 30 times a second.
struct KeywordGlyph: View {
    let style: KeywordStyle
    var size: CGFloat = 11
    var active: Bool = true

    @Environment(\.deckPanelVisible) private var panelVisible

    var body: some View {
        if style.spins, panelVisible, active, let image = lucideImage(style.icon, size) {
            SpinningKeywordGlyph(image: image, color: NSColor(style.accent))
                .frame(width: size, height: size)
        } else {
            KeywordGlyphImage(style: style, size: size, active: active)
        }
    }
}

private struct KeywordGlyphImage: View {
    let style: KeywordStyle
    let size: CGFloat
    let active: Bool

    var body: some View {
        Group {
            if let image = lucideImage(style.icon, size) {
                Image(nsImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .frame(width: size, height: size)
            } else {
                Circle()
                    .frame(width: size * 0.7, height: size * 0.7)
            }
        }
        .foregroundColor(active ? style.accent : DeckPalette.tertiary)
    }
}

private struct SpinningKeywordGlyph: NSViewRepresentable {
    let image: NSImage
    let color: NSColor

    func makeNSView(context: Context) -> SpinnerView {
        let view = SpinnerView()
        view.configure(image: image, color: color)
        return view
    }

    func updateNSView(_ view: SpinnerView, context: Context) {
        view.configure(image: image, color: color)
    }
}

private final class SpinnerView: NSView {
    private let spinLayer = CALayer()
    private var tinted: NSImage?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        spinLayer.contentsGravity = .resizeAspect
        spinLayer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer?.addSublayer(spinLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(image: NSImage, color: NSColor) {
        tinted = image.deckTinted(color)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        guard bounds.width > 0, bounds.height > 0 else { return }
        spinLayer.bounds = bounds
        spinLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
        spinLayer.contentsScale = window?.backingScaleFactor ?? 2
        if let tinted = tinted, let cg = tinted.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            spinLayer.contents = cg
        }
        if spinLayer.animation(forKey: "deck-spin") == nil {
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.fromValue = 0.0
            spin.toValue = Double.pi * 2
            spin.duration = 0.8
            spin.repeatCount = .infinity
            spin.timingFunction = CAMediaTimingFunction(name: .linear)
            spinLayer.add(spin, forKey: "deck-spin")
        }
    }
}

private extension NSImage {
    func deckTinted(_ color: NSColor) -> NSImage {
        let scale: CGFloat = 3
        let target = NSSize(
            width: max(1, size.width * scale),
            height: max(1, size.height * scale)
        )
        return NSImage(size: target, flipped: false) { rect in
            self.draw(in: rect)
            guard let context = NSGraphicsContext.current else { return true }
            context.saveGraphicsState()
            context.compositingOperation = .sourceAtop
            color.setFill()
            NSBezierPath(rect: rect).fill()
            context.restoreGraphicsState()
            return true
        }
    }
}

// MARK: - Agents

struct AgentStyle {
    let id: String
    let color: Color
    let tint: Color
    let glyph: String
    let short: String
}

enum DeckAgents {
    static func style(id: String, fallbackColor: String, fallbackGlyph: String, fallbackShort: String) -> AgentStyle {
        switch id {
        case "claude":
            return AgentStyle(
                id: "claude",
                color: .solid("#A86F58", "#D49A84"),
                tint: .solid("#F5EAE4", "#35261F"),
                glyph: "✳", short: "Claude"
            )
        case "codex":
            return AgentStyle(
                id: "codex",
                color: .solid("#71899D", "#9DB5C9"),
                tint: .solid("#E9EEF2", "#222B33"),
                glyph: "⌘", short: "Codex"
            )
        case "workbuddy":
            return AgentStyle(
                id: "workbuddy",
                color: .solid("#71917F", "#9CBDAA"),
                tint: .solid("#E8F0EB", "#212E27"),
                glyph: "✦", short: "WorkBuddy"
            )
        case "dsh":
            return AgentStyle(
                id: "dsh",
                color: .solid("#767FAE", "#A2ABD6"),
                tint: .solid("#EAECF4", "#25283A"),
                glyph: "◈", short: "DSH"
            )
        case "cursor":
            return AgentStyle(
                id: "cursor",
                color: .solid("#5F7D95", "#89A7BF"),
                tint: .solid("#E7EDF2", "#1F2932"),
                glyph: "▸", short: "Cursor"
            )
        case "trae":
            return AgentStyle(
                id: "trae",
                color: .solid("#10B981", "#34D399"),
                tint: .solid("#E6F9F2", "#133529"),
                glyph: "▸", short: "Trae"
            )
        case "grokbot":
            return AgentStyle(
                id: "grokbot",
                color: .solid("#5B6472", "#9DA7B8"),
                tint: .solid("#EBEEF2", "#222730"),
                glyph: "✧", short: "Grok Bot"
            )
        case "hermes":
            return AgentStyle(
                id: "hermes",
                color: .solid("#B57536", "#E0A060"),
                tint: .solid("#F6EDE3", "#36271A"),
                glyph: "☿", short: "Hermes"
            )
        case "minimax":
            return AgentStyle(
                id: "minimax",
                color: .solid("#E24D6A", "#F27992"),
                tint: .solid("#FCEBEF", "#3B1C24"),
                glyph: "◆", short: "MiniMax"
            )
        case "qwenwork":
            return AgentStyle(
                id: "qwenwork",
                color: .solid("#6B63D6", "#9A93F2"),
                tint: .solid("#ECEBFA", "#232140"),
                glyph: "✦", short: "千问办公"
            )
        case "t3code":
            return AgentStyle(
                id: "t3code",
                color: .solid("#3D7BD9", "#6EA3F2"),
                tint: .solid("#E8F0FC", "#1C293D"),
                glyph: "◩", short: "T3 Code"
            )
        case "cindy":
            return AgentStyle(
                id: "cindy",
                color: .solid("#0EA5E9", "#38BDF8"),
                tint: .solid("#E8F6FE", "#182D3B"),
                glyph: "❖", short: "Cindy"
            )
        case "orca":
            return AgentStyle(
                id: "orca",
                color: .solid("#0F766E", "#2DD4BF"),
                tint: .solid("#E6F7F5", "#133532"),
                glyph: "◉", short: "Orca"
            )
        case "muse":
            return AgentStyle(
                id: "muse",
                color: .solid("#C96F8F", "#E694B2"),
                tint: .solid("#F9ECF1", "#38212A"),
                glyph: "❋", short: "Muse"
            )
        case "kimicode":
            return AgentStyle(
                id: "kimicode",
                color: .solid("#2B6CB0", "#63A4E8"),
                tint: .solid("#E8F1FA", "#1B2A3C"),
                glyph: "◈", short: "Kimi Code"
            )
        case "doubaowork":
            return AgentStyle(
                id: "doubaowork",
                color: .solid("#3B82F6", "#74A8FF"),
                tint: .solid("#EAF2FF", "#1B2A42"),
                glyph: "◎", short: "豆包工作"
            )
        case "gemini":
            return AgentStyle(
                id: "gemini",
                color: .solid("#4285F4", "#7AA8FF"),
                tint: .solid("#EBF2FE", "#1B2942"),
                glyph: "✦", short: "Gemini CLI"
            )
        case "teleagent":
            return AgentStyle(
                id: "teleagent",
                color: .solid("#2F7D6D", "#58B3A0"),
                tint: .solid("#E6F4F1", "#19302B"),
                glyph: "✳", short: "TeleAgent"
            )
        default:
            let base = Color(hex: fallbackColor)
            return AgentStyle(
                id: id,
                color: base,
                tint: base.opacity(0.14),
                glyph: fallbackGlyph.isEmpty ? "•" : fallbackGlyph,
                short: fallbackShort.isEmpty ? id : fallbackShort
            )
        }
    }

    static func style(for session: MenuSession) -> AgentStyle {
        style(id: session.agent, fallbackColor: session.color, fallbackGlyph: session.glyph, fallbackShort: session.shortAgent)
    }

    static func style(for agent: MenuAgent) -> AgentStyle {
        style(id: agent.id, fallbackColor: agent.color, fallbackGlyph: agent.glyph, fallbackShort: agent.short)
    }
}

// 官方 App 图标：插件启动时把 PNG 写到 ~/.agent-deck/agents/，这里按 id 读
private let deckAgentIcons = NSCache<NSString, NSImage>()
func agentAppIcon(_ id: String) -> NSImage? {
    if let cached = deckAgentIcons.object(forKey: id as NSString) { return cached }
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".agent-deck/agents/\(id).png")
    guard let image = NSImage(contentsOfFile: path) else { return nil }
    deckAgentIcons.setObject(image, forKey: id as NSString)
    return image
}

// MARK: - Shared atoms

struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(DeckPalette.divider)
            .frame(height: 1)
    }
}

struct AgentBadge: View {
    let style: AgentStyle
    var size: CGFloat = 26

    var body: some View {
        if let image = agentAppIcon(style.id) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .frame(width: size * 0.82, height: size * 0.82)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
                .frame(width: size, height: size)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .fill(style.tint)
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .strokeBorder(style.color.opacity(0.35), lineWidth: 1)
                Text(style.glyph)
                    .font(.system(size: size * 0.44, weight: .bold))
                    .foregroundColor(style.color)
            }
            .frame(width: size, height: size)
        }
    }
}

struct KeywordChip: View {
    let style: KeywordStyle

    var body: some View {
        HStack(spacing: 4) {
            KeywordGlyph(style: style, size: 11)
            Text(style.code)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .kerning(0.15)
        }
        .foregroundColor(style.ink)
        .padding(.horizontal, 6)
        .padding(.vertical, 2.5)
        .background(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(style.tint)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(style.accent.opacity(0.55), lineWidth: 1)
        )
        .help("\(style.code) · \(style.zh)")
        .fixedSize()
    }
}

// MARK: - Header

struct StatBlock: View {
    let label: String
    let value: Int
    let style: KeywordStyle

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(label)
                .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                .kerning(0.7)
                .foregroundColor(style.accent)
            Text("\(value)")
                .font(.system(size: 19, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(value > 0 ? style.ink : DeckPalette.tertiary)
        }
        .frame(minWidth: 40, alignment: .trailing)
    }
}

struct AgentPill: View {
    let agent: MenuAgent

    var body: some View {
        let style = DeckAgents.style(for: agent)
        HStack(spacing: 4) {
            if let image = agentAppIcon(agent.id) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 12, height: 12)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            } else {
                Text(style.glyph)
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundColor(style.color)
            }
            Text(agent.short.isEmpty ? style.short : agent.short)
                .font(.system(size: 9.5, weight: agent.primary ? .bold : .semibold))
                .foregroundColor(DeckPalette.ink)
                .lineLimit(1)
            if let today = agent.today, !today.isEmpty {
                Text(today)
                    .font(.system(size: 8.5, weight: .medium).monospacedDigit())
                    .foregroundColor(DeckPalette.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 3)
            HStack(spacing: 2) {
                KeywordGlyph(style: DeckKeywords.doing, size: 10, active: agent.running > 0)
                Text("\(agent.running)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(agent.running > 0 ? DeckKeywords.doing.accent : DeckPalette.tertiary)
            }
            HStack(spacing: 2) {
                KeywordGlyph(style: DeckKeywords.waiting, size: 10, active: agent.waiting > 0)
                Text("\(agent.waiting)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(agent.waiting > 0 ? DeckKeywords.waiting.accent : DeckPalette.tertiary)
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity)
        .background(Capsule(style: .continuous).fill(style.tint))
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(style.color.opacity(agent.primary ? 0.42 : 0.24), lineWidth: 1)
        )
        .help("\(L("跑")) \(agent.running) · \(L("等")) \(agent.waiting)")
    }
}

struct PinIconButton: View {
    let pinned: Bool
    let size: CGFloat
    let helpText: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if let image = lucideImage(lucidePinSVG, size) {
                    Image(nsImage: image)
                        .renderingMode(.template)
                        .rotationEffect(.degrees(pinned ? 0 : 40))
                } else {
                    Image(systemName: pinned ? "pin.fill" : "pin")
                        .font(.system(size: size, weight: .semibold))
                }
            }
            .foregroundColor(pinned ? DeckPalette.brand : (hovering ? DeckPalette.ink : DeckPalette.tertiary))
            .frame(width: size + 10, height: size + 10)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(pinned ? DeckPalette.brand.opacity(0.14) : (hovering ? DeckPalette.pill : .clear))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(pinned ? DeckPalette.brand.opacity(0.45) : .clear, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(helpText)
        .onHover { inside in hovering = inside }
    }
}

struct HeaderBlock: View {
    let state: MenuState
    let panelPinned: Bool
    let onTogglePinPanel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                // No app icon or name here: the panel hangs from the menu bar icon,
                // so the header starts straight with today's numbers.
                if let stats = state.stats, !stats.isEmpty {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(Array(stats.enumerated()), id: \.offset) { _, stat in
                            VStack(alignment: .leading, spacing: 0) {
                                Text(stat.label)
                                    .font(.system(size: 8.5, weight: .semibold))
                                    .foregroundColor(DeckPalette.tertiary)
                                    .lineLimit(1)
                                    .fixedSize()
                                Text(stat.value)
                                    .font(.system(size: 14, weight: .semibold, design: .rounded).monospacedDigit())
                                    .foregroundColor(DeckPalette.ink)
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                        }
                    }
                    .padding(.top, 1)
                } else {
                    Text(state.usageLine)
                        .font(.system(size: 12.5, weight: .semibold).monospacedDigit())
                        .foregroundColor(DeckPalette.ink)
                        .lineLimit(1)
                        .padding(.top, 2)
                }

                Spacer(minLength: 6)

                HStack(alignment: .top, spacing: 10) {
                    StatBlock(label: "DOING", value: state.running, style: DeckKeywords.doing)
                    StatBlock(label: "WAITING", value: state.waiting, style: DeckKeywords.waiting)
                    PinIconButton(
                        pinned: panelPinned,
                        size: 11,
                        helpText: L(panelPinned ? "取消固定（点击外部自动收起）" : "固定面板（始终显示）"),
                        action: onTogglePinPanel
                    )
                }
            }

            if state.needsApproval > 0 {
                HStack(spacing: 5) {
                    KeywordGlyph(style: DeckKeywords.needok, size: 10)
                    Text(L("{n} 个 NEEDOK? 需要你允许", ["n": "\(state.needsApproval)"]))
                        .font(.system(size: 9.5, weight: .semibold))
                }
                .foregroundColor(DeckKeywords.needok.ink)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule(style: .continuous).fill(DeckKeywords.needok.tint)
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(DeckKeywords.needok.accent.opacity(0.5), lineWidth: 1)
                )
            }

            if let agents = state.agents, !agents.isEmpty {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 4),
                        GridItem(.flexible(), spacing: 4),
                    ],
                    spacing: 4
                ) {
                    ForEach(agents) { AgentPill(agent: $0) }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DeckPalette.headerTint)
    }
}

// MARK: - Session list

struct MetaText: View {
    let session: MenuSession
    let agent: AgentStyle

    var body: some View {
        HStack(spacing: 4) {
            if session.hasStructuredMeta {
                Text(session.shortAgent)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(agent.color)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .layoutPriority(1.5)
                if let project = session.project, !project.isEmpty {
                    Text("·")
                        .foregroundColor(DeckPalette.tertiary)
                    Text(project)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DeckPalette.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .layoutPriority(1)
                }
                if let step = session.step, !step.isEmpty {
                    Text("·")
                        .foregroundColor(DeckPalette.tertiary)
                    Text(step)
                        .font(.system(size: 10))
                        .foregroundColor(DeckPalette.tertiary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 4)
                if let ago = session.ago, !ago.isEmpty {
                    Text(ago)
                        .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                        .foregroundColor(DeckPalette.tertiary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(2)
                }
            } else {
                Text(session.detail)
                    .font(.system(size: 10))
                    .foregroundColor(DeckPalette.secondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
            }
            if let image = lucideImage(lucideArrowSVG, 9) {
                Image(nsImage: image)
                    .renderingMode(.template)
                    .foregroundColor(DeckPalette.tertiary)
            } else {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(DeckPalette.tertiary)
            }
        }
    }
}

struct SessionCardView: View {
    let session: MenuSession
    let pinned: Bool
    let onTogglePin: () -> Void
    @State private var hovering = false

    var body: some View {
        let agent = DeckAgents.style(for: session)
        let keyword = DeckKeywords.style(for: session.keywordCode)
        HStack(alignment: .center, spacing: 8) {
            AgentBadge(style: agent)
                .contentShape(Rectangle())
                .onTapGesture { openSession(session) }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    HStack(spacing: 4) {
                        Text(session.displayTitle)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(DeckPalette.ink)
                            .lineLimit(1)
                            .help(session.title)
                        Spacer(minLength: 4)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { openSession(session) }

                    if pinned || hovering {
                        PinIconButton(
                            pinned: pinned,
                            size: 10,
                            helpText: L(pinned ? "取消置顶此会话" : "置顶此会话到最上方"),
                            action: onTogglePin
                        )
                    }
                    KeywordChip(style: keyword)
                        .onTapGesture { openSession(session) }
                }
                MetaText(session: session, agent: agent)
                    .contentShape(Rectangle())
                    .onTapGesture { openSession(session) }
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 46, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(hovering ? DeckPalette.cardHover : DeckPalette.card)
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(pinned ? DeckPalette.brand : keyword.accent)
                .frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(
                    hovering
                        ? DeckPalette.cardBorderHover
                        : (pinned ? DeckPalette.brand.opacity(0.45) : DeckPalette.cardBorder),
                    lineWidth: 1
                )
        )
        .shadow(
            color: Color.black.opacity(hovering ? 0.18 : 0.10),
            radius: hovering ? 8 : 5,
            x: 0,
            y: hovering ? 4 : 2
        )
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.12)) { hovering = inside }
        }
    }
}

struct NowGroupBar: View {
    @ObservedObject var model: MenuModel

    private let options: [(id: String, label: String)] = [
        ("project", "按项目"),
        ("status", "按状态"),
        ("flat", "列表"),
    ]

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(DeckPalette.brand)
                    .frame(width: 3, height: 11)
                Text(L("现在"))
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundColor(DeckPalette.ink)
            }
            Spacer(minLength: 4)
            HStack(spacing: 3) {
                ForEach(options, id: \.id) { opt in
                    let active = model.activeGroupBy == opt.id
                    Button(action: { model.setGroupBy(opt.id) }) {
                        Text(L(opt.label))
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundColor(active ? DeckPalette.ink : DeckPalette.secondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2.5)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(active ? DeckPalette.card : .clear)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(active ? DeckPalette.cardBorder : .clear, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(DeckPalette.pill))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(DeckPalette.headerTint)
    }
}

struct GroupPill: View {
    let text: String
    let tone: String // "live" | "wait" | "error"

    private var style: KeywordStyle {
        switch tone {
        case "live": return DeckKeywords.doing
        case "error": return DeckKeywords.errored
        default: return DeckKeywords.waiting
        }
    }

    var body: some View {
        Text(text)
            .font(.system(size: 8.5, weight: .semibold))
            .foregroundColor(style.ink)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule(style: .continuous).fill(style.tint))
            .overlay(Capsule(style: .continuous).strokeBorder(style.accent.opacity(0.45), lineWidth: 1))
            .lineLimit(1)
            .fixedSize()
    }
}

struct GroupHeaderRow: View {
    let group: MenuGroup
    let mode: String
    let collapsed: Bool
    let agentStyles: [String: AgentStyle]
    let onToggle: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 5) {
                Text(collapsed ? "▸" : "▾")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(DeckPalette.secondary)
                    .frame(width: 10)
                Text(group.name)
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundColor(DeckPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if mode == "project", let agents = group.agents, !agents.isEmpty {
                    HStack(spacing: 3) {
                        ForEach(agents.prefix(4), id: \.self) { id in
                            if let icon = agentAppIcon(id) {
                                Image(nsImage: icon)
                                    .resizable()
                                    .interpolation(.high)
                                    .frame(width: 11, height: 11)
                                    .clipShape(RoundedRectangle(cornerRadius: 2.5, style: .continuous))
                            } else {
                                let st = agentStyles[id]
                                Text(st?.glyph ?? "•")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(st?.color ?? DeckPalette.secondary)
                            }
                        }
                    }
                }
                Spacer(minLength: 4)
                if mode == "status" {
                    GroupPill(text: "\(group.sessions.count)", tone: group.tone ?? "wait")
                } else {
                    HStack(spacing: 4) {
                        if (group.running ?? 0) > 0 {
                            GroupPill(text: L("{n} 在跑", ["n": "\(group.running ?? 0)"]), tone: "live")
                        }
                        if (group.waiting ?? 0) > 0 {
                            GroupPill(text: L("{n} 等你", ["n": "\(group.waiting ?? 0)"]), tone: "wait")
                        }
                        if (group.issue ?? 0) > 0 {
                            GroupPill(text: L("{n} 异常", ["n": "\(group.issue ?? 0)"]), tone: "error")
                        }
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(hovering ? DeckPalette.cardHover : DeckPalette.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(
                        group.attention == true
                            ? DeckKeywords.waiting.accent.opacity(0.45)
                            : DeckPalette.cardBorder,
                        lineWidth: 1
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

struct EmptyState: View {
    var body: some View {
        VStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DeckKeywords.todo.tint)
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(DeckKeywords.todo.accent.opacity(0.35), lineWidth: 1)
                Image(systemName: "checklist")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DeckKeywords.todo.accent)
            }
            .frame(width: 40, height: 40)

            HStack(spacing: 5) {
                KeywordChip(style: DeckKeywords.todo)
                Text(L("现在没有在跑的会话"))
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(DeckPalette.ink)
            }
            Text(L("等待中的提问或终端任务、待认领与在跑会话会出现在这里。"))
                .font(.system(size: 10))
                .foregroundColor(DeckPalette.secondary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .frame(maxWidth: 300)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 26)
    }
}

struct SessionListView: View {
    @ObservedObject var model: MenuModel

    private var agentStylesById: [String: AgentStyle] {
        var map: [String: AgentStyle] = [:]
        for a in model.state.agents ?? [] {
            map[a.id] = DeckAgents.style(for: a)
        }
        return map
    }

    var body: some View {
        let mode = model.activeGroupBy
        let groups = model.activeGroups()
        let flat = model.orderedFlatSessions()
        let styles = agentStylesById

        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(alignment: .leading, spacing: 4) {
                if (mode == "project" || mode == "status"), !groups.isEmpty {
                    ForEach(groups) { group in
                        let collapsed = model.isGroupCollapsed(mode, group.id)
                        GroupHeaderRow(
                            group: group,
                            mode: mode,
                            collapsed: collapsed,
                            agentStyles: styles
                        ) {
                            model.toggleGroupCollapsed(mode, group.id)
                        }
                        if !collapsed {
                            ForEach(group.sessions) { session in
                                SessionCardView(session: session, pinned: model.isSessionPinned(session)) {
                                    model.togglePinSession(session)
                                }
                            }
                        }
                    }
                } else {
                    ForEach(flat) { session in
                        SessionCardView(session: session, pinned: model.isSessionPinned(session)) {
                            model.togglePinSession(session)
                        }
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .padding(.bottom, 8)
        }
        .scrollIndicators(.visible)
    }
}

// MARK: - Footer

enum FooterKind {
    case primary
    case secondary
    case quiet
}

struct FooterButton: View {
    let title: String
    let kind: FooterKind
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: kind == .quiet ? 9.5 : 10.5, weight: .semibold))
                .foregroundColor(foreground)
                .padding(.horizontal, kind == .quiet ? 6 : 9)
                .padding(.vertical, kind == .quiet ? 3 : 5)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(border, lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.1)) { hovering = inside }
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary, .secondary:
            return DeckPalette.ink
        case .quiet:
            return hovering ? DeckPalette.ink : DeckPalette.secondary
        }
    }

    private var background: Color {
        switch kind {
        // Buttons stay in the panel's own neutrals: the primary one is a shade
        // darker than the background, the secondary one is an outline.
        case .primary:
            return hovering ? DeckPalette.cardBorder : DeckPalette.pill
        case .secondary:
            return hovering ? DeckPalette.card : .clear
        case .quiet:
            return hovering ? DeckPalette.pill : .clear
        }
    }

    private var border: Color {
        switch kind {
        case .primary:
            return .clear
        case .secondary:
            return hovering ? DeckPalette.cardBorderHover : DeckPalette.cardBorder
        case .quiet:
            return .clear
        }
    }
}

struct FooterBlock: View {
    let sessionCount: Int

    private var hint: String {
        if sessionCount == 0 { return L("等待 Agent 会话") }
        return sessionCount > 8 ? L("共 {n} 个 · 向下滑动", ["n": "\(sessionCount)"]) : L("点击卡片跳转")
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(hint)
                .font(.system(size: 9))
                .foregroundColor(DeckPalette.tertiary)
                .lineLimit(1)
            FooterButton(title: L("打开面板"), kind: .primary) {
                adOpen("obsidian://agent-deck")
            }
            FooterButton(title: L("重新扫描"), kind: .secondary) {
                adOpen("obsidian://agent-deck?do=scan")
            }
            Spacer(minLength: 4)
            FooterButton(title: L("隐藏"), kind: .quiet) {
                adOpen("obsidian://agent-deck?do=hide")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity)
        .background(DeckPalette.headerTint)
    }
}

// MARK: - Frosted Glass Backdrop

struct GlassBackdrop: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .popover
    var cornerRadius: CGFloat = 16

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
        view.wantsLayer = true
        view.layer?.cornerRadius = cornerRadius
        view.layer?.masksToBounds = true
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
        view.layer?.cornerRadius = cornerRadius
        view.layer?.masksToBounds = true
    }
}

// MARK: - Root

struct DeckView: View {
    @ObservedObject var model: MenuModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBlock(state: model.state, panelPinned: model.panelPinned) {
                model.togglePanelPin()
            }
            Hairline()
            NowGroupBar(model: model)
            Hairline()
            if model.visibleSessionCount == 0 {
                EmptyState()
            } else {
                SessionListView(model: model)
                    .frame(maxHeight: .infinity)
            }
            Hairline()
            FooterBlock(sessionCount: model.visibleSessionCount)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            ZStack {
                GlassBackdrop(material: .popover, cornerRadius: 16)
                DeckPalette.panelTint
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DeckPalette.panelBorder.opacity(0.75), lineWidth: 1)
        )
        .environment(\.deckPanelVisible, model.panelVisible)
    }
}

// MARK: - Panel + app

final class DeckPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct DeckHotKey {
    static let defaultSpec = "control+option+command+D"

    let canonical: String
    let keyCode: UInt32
    let modifiers: UInt32

    static func parse(_ raw: String?) -> DeckHotKey? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        var modifiers: UInt32 = 0
        var keyName: String?

        for token in raw.split(separator: "+") {
            let token = token.trimmingCharacters(in: .whitespaces).lowercased()
            switch token {
            case "control", "ctrl", "⌃":
                modifiers |= UInt32(controlKey)
            case "option", "alt", "⌥":
                modifiers |= UInt32(optionKey)
            case "shift", "⇧":
                modifiers |= UInt32(shiftKey)
            case "command", "cmd", "⌘":
                modifiers |= UInt32(cmdKey)
            default:
                if !token.isEmpty { keyName = token.uppercased() }
            }
        }

        guard let keyName = keyName, let keyCode = keyCodes[keyName] else { return nil }
        let required = UInt32(controlKey | optionKey | cmdKey)
        guard modifiers & required != 0 else { return nil }

        var parts: [String] = []
        if modifiers & UInt32(controlKey) != 0 { parts.append("control") }
        if modifiers & UInt32(optionKey) != 0 { parts.append("option") }
        if modifiers & UInt32(shiftKey) != 0 { parts.append("shift") }
        if modifiers & UInt32(cmdKey) != 0 { parts.append("command") }
        parts.append(keyName)

        return DeckHotKey(
            canonical: parts.joined(separator: "+"),
            keyCode: keyCode,
            modifiers: modifiers
        )
    }

    private static let keyCodes: [String: UInt32] = [
        "A": UInt32(kVK_ANSI_A), "B": UInt32(kVK_ANSI_B), "C": UInt32(kVK_ANSI_C),
        "D": UInt32(kVK_ANSI_D), "E": UInt32(kVK_ANSI_E), "F": UInt32(kVK_ANSI_F),
        "G": UInt32(kVK_ANSI_G), "H": UInt32(kVK_ANSI_H), "I": UInt32(kVK_ANSI_I),
        "J": UInt32(kVK_ANSI_J), "K": UInt32(kVK_ANSI_K), "L": UInt32(kVK_ANSI_L),
        "M": UInt32(kVK_ANSI_M), "N": UInt32(kVK_ANSI_N), "O": UInt32(kVK_ANSI_O),
        "P": UInt32(kVK_ANSI_P), "Q": UInt32(kVK_ANSI_Q), "R": UInt32(kVK_ANSI_R),
        "S": UInt32(kVK_ANSI_S), "T": UInt32(kVK_ANSI_T), "U": UInt32(kVK_ANSI_U),
        "V": UInt32(kVK_ANSI_V), "W": UInt32(kVK_ANSI_W), "X": UInt32(kVK_ANSI_X),
        "Y": UInt32(kVK_ANSI_Y), "Z": UInt32(kVK_ANSI_Z),
        "0": UInt32(kVK_ANSI_0), "1": UInt32(kVK_ANSI_1), "2": UInt32(kVK_ANSI_2),
        "3": UInt32(kVK_ANSI_3), "4": UInt32(kVK_ANSI_4), "5": UInt32(kVK_ANSI_5),
        "6": UInt32(kVK_ANSI_6), "7": UInt32(kVK_ANSI_7), "8": UInt32(kVK_ANSI_8),
        "9": UInt32(kVK_ANSI_9),
        "F1": UInt32(kVK_F1), "F2": UInt32(kVK_F2), "F3": UInt32(kVK_F3),
        "F4": UInt32(kVK_F4), "F5": UInt32(kVK_F5), "F6": UInt32(kVK_F6),
        "F7": UInt32(kVK_F7), "F8": UInt32(kVK_F8), "F9": UInt32(kVK_F9),
        "F10": UInt32(kVK_F10), "F11": UInt32(kVK_F11), "F12": UInt32(kVK_F12),
    ]
}

private func deckHotKeyHandler(
    _ callRef: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData = userData else { return noErr }
    let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
    // 快捷键按一下开、再按一下收
    delegate.togglePanel()
    return noErr
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var statusItem: NSStatusItem!
    var panel: DeckPanel!
    var model: MenuModel!
    var hosting: NSHostingView<DeckView>!
    var container: NSView!
    var statePath: String = NSString(string: "~/.agent-deck/menubar.json").expandingTildeInPath
    var parentPid: Int32 = 0
    var preview = false
    var monitors: [Any] = []
    var dismissObserver: NSObjectProtocol?
    var hotKeyRef: EventHotKeyRef?
    var hotKeyHandler: EventHandlerRef?
    var currentHotKey = ""
    var hotKeySequence: UInt32 = 1
    var isProgrammaticLayout = false

    let panelWidth: CGFloat = 436

    /// Carbon hotkeys work even when the status item is hidden and do not need
    /// Accessibility access. The plugin sends the user's choice in menubar.json.
    func installHotKeyHandler() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        _ = InstallEventHandler(
            GetApplicationEventTarget(),
            deckHotKeyHandler,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &hotKeyHandler
        )
        applyHotKey(DeckHotKey.defaultSpec)
    }

    func applyHotKey(_ raw: String?) {
        guard let spec = DeckHotKey.parse(raw) ?? DeckHotKey.parse(DeckHotKey.defaultSpec) else { return }
        if spec.canonical == currentHotKey, hotKeyRef != nil { return }

        hotKeySequence += 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x41444B31), id: hotKeySequence)
        var newRef: EventHotKeyRef?
        let status = RegisterEventHotKey(
            spec.keyCode,
            spec.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &newRef
        )

        if status == noErr, let newRef = newRef {
            if let oldRef = hotKeyRef { UnregisterEventHotKey(oldRef) }
            hotKeyRef = newRef
            currentHotKey = spec.canonical
            return
        }

        // The requested combination is taken. Keep the previous shortcut if we
        // have one; otherwise fall back to the default.
        if hotKeyRef == nil, let fallback = DeckHotKey.parse(DeckHotKey.defaultSpec), fallback.canonical != spec.canonical {
            hotKeySequence += 1
            let fallbackID = EventHotKeyID(signature: OSType(0x41444B31), id: hotKeySequence)
            _ = RegisterEventHotKey(
                fallback.keyCode,
                fallback.modifiers,
                fallbackID,
                GetApplicationEventTarget(),
                0,
                &hotKeyRef
            )
            currentHotKey = fallback.canonical
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--state"), i + 1 < args.count { statePath = args[i + 1] }
        if let i = args.firstIndex(of: "--parent"), i + 1 < args.count { parentPid = Int32(args[i + 1]) ?? 0 }
        if let i = args.firstIndex(of: "--appearance"), i + 1 < args.count {
            NSApp.appearance = NSAppearance(named: args[i + 1] == "dark" ? .darkAqua : .aqua)
        }
        preview = args.contains("--preview")
        var pidPath = ""
        if let i = args.firstIndex(of: "--pidfile"), i + 1 < args.count { pidPath = args[i + 1] }

        model = MenuModel(statePath: statePath, parentPid: parentPid)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.behavior = .removalAllowed
        statusItem.isVisible = true
        if let button = statusItem.button {
            if let image = lucideImage(lucideWandSVG, 18) {
                button.image = image
            } else {
                let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Agent Deck")
                image?.isTemplate = true
                button.image = image
            }
            button.imagePosition = .imageOnly
            button.title = ""
            button.toolTip = "Agent Deck"
            button.target = self
            button.action = #selector(togglePanel)
        }

        hostPanel()
        if !preview { installHotKeyHandler() }

        dismissObserver = NotificationCenter.default.addObserver(
            forName: .agentDeckDismiss, object: nil, queue: .main
        ) { [weak self] _ in
            if self?.model.panelPinned != true {
                self?.hidePanel()
            }
        }

        model.onUpdate = { [weak self] in self?.refresh() }
        model.onShowRequest = { [weak self] in self?.showPanel() }
        model.onPinModeChanged = { [weak self] in self?.applyPinnedWindowBehavior(userTriggered: true) }
        model.start()
        refresh()
        forceDisplay()
        applyPinnedWindowBehavior(userTriggered: false)
        // Write the pid file only after lastShowAt has been recorded, so an
        // Obsidian command that waits for this pid cannot race the listener.
        if !pidPath.isEmpty {
            try? "\(getpid())".write(toFile: pidPath, atomically: true, encoding: .utf8)
        }

        if preview {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                self?.showPanel()
            }
        } else if model.panelPinned {
            DispatchQueue.main.async { [weak self] in
                self?.showPanel(activate: false)
            }
        }
    }

    func hostPanel() {
        let root = DeckView(model: model)
        hosting = NSHostingView(rootView: root)
        hosting.wantsLayer = true
        hosting.autoresizingMask = [.width, .height]

        // A plain container keeps NSHostingView's intrinsic height from
        // resizing the borderless window (maxHeight: .infinity otherwise asks
        // for the whole screen).
        container = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: 500))
        container.wantsLayer = true
        hosting.frame = container.bounds
        container.addSubview(hosting)

        panel = DeckPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: 500),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.delegate = self
        panel.contentView = container
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isMovableByWindowBackground = false
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    }

    func applyPinnedWindowBehavior(userTriggered: Bool) {
        let pinned = model.panelPinned
        panel.level = pinned ? .floating : .statusBar
        panel.isMovable = pinned
        panel.isMovableByWindowBackground = pinned
        if pinned {
            removeMonitors()
            if userTriggered, panel.isVisible {
                // Pinning locks the panel right where it currently is instead of jumping to a stale saved coordinate.
                model.savePinnedOrigin(NSPoint(x: panel.frame.minX, y: panel.frame.maxY))
            }
        } else if panel.isVisible {
            installMonitors()
            layoutPanel()
        }
    }

    func windowDidMove(_ notification: Notification) {
        // Only record user-initiated drags; ignore programmatic layout or macOS space/display shifts.
        guard !isProgrammaticLayout, model.panelPinned, panel.isVisible, NSEvent.pressedMouseButtons != 0 else { return }
        model.savePinnedOrigin(NSPoint(x: panel.frame.minX, y: panel.frame.maxY))
    }

    func refresh() {
        let height = panelHeightForScreen()
        let resized = abs(panel.frame.height - height) > 0.5
        if panel.isVisible {
            if model.panelPinned {
                // Keep a pinned panel anchored in place; only resize downward from its top-left when height changes.
                if resized {
                    resizePinnedPanel(to: height)
                    forceDisplay()
                }
            } else {
                if resized {
                    isProgrammaticLayout = true
                    panel.setContentSize(NSSize(width: panelWidth, height: height))
                    isProgrammaticLayout = false
                }
                layoutPanel()
                if resized { forceDisplay() }
            }
        } else if resized {
            isProgrammaticLayout = true
            panel.setContentSize(NSSize(width: panelWidth, height: height))
            isProgrammaticLayout = false
        }
        if hotKeyHandler != nil {
            applyHotKey(model.state.hotkey)
        }
    }

    func resizePinnedPanel(to height: CGFloat) {
        let anchor = model.savedPinnedOrigin ?? NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        let screen = screenForPinnedAnchor(anchor)
        var x = anchor.x
        var y = anchor.y - height
        if let visible = screen?.visibleFrame {
            x = min(max(x, visible.minX + 8), visible.maxX - panelWidth - 8)
            if y < visible.minY + 8 { y = visible.minY + 8 }
            if y + height > visible.maxY - 4 { y = visible.maxY - 4 - height }
        }
        setPanelFrame(NSRect(x: x.rounded(), y: y.rounded(), width: panelWidth, height: height.rounded()))
    }

    func screenForPinnedAnchor(_ topLeft: NSPoint) -> NSScreen? {
        let probe = NSPoint(x: topLeft.x + panelWidth / 2, y: topLeft.y - 20)
        return NSScreen.screens.first(where: { $0.frame.contains(probe) })
            ?? panel.screen
            ?? NSScreen.main
    }

    func panelHeightForScreen() -> CGFloat {
        let desired = desiredHeight()
        let screen = (model.panelPinned ? panel.screen : statusItem.button?.window?.screen) ?? NSScreen.main
        if let screen = screen {
            return min(desired, screen.visibleFrame.height - 24)
        }
        return desired
    }

    /// Keep this in sync with the SwiftUI blocks above so the panel grows and
    /// shrinks tightly with the actual visible groups and tasks.
    func desiredHeight() -> CGFloat {
        let count = model.visibleSessionCount
        let agentRows = max(1, ((model.state.agents?.count ?? 0) + 1) / 2)
        let headerBlock: CGFloat = 112 + CGFloat(agentRows - 1) * 21 + (model.state.needsApproval > 0 ? 27 : 0)
        let footer: CGFloat = 39
        if count == 0 { return headerBlock + 150 + footer + 2 }

        let mode = model.activeGroupBy
        let groups = (mode == "project" || mode == "status") ? model.activeGroups() : []
        var cardSlots = 0
        var headerCount = 0
        if !groups.isEmpty {
            for g in groups {
                headerCount += 1
                if !model.isGroupCollapsed(mode, g.id) {
                    cardSlots += g.sessions.count
                }
            }
        }
        let shownCards = groups.isEmpty ? count : cardSlots
        let gaps = max(0, headerCount + shownCards - 1)
        let contentBody = 6 + CGFloat(headerCount) * 24 + CGFloat(gaps) * 4 + CGFloat(shownCards) * 48 + 10
        let body = max(56, contentBody)
        return min(720, headerBlock + body + footer + 2)
    }

    func setPanelFrame(_ rect: NSRect) {
        isProgrammaticLayout = true
        panel.setFrame(rect, display: true)
        isProgrammaticLayout = false
    }

    func layoutPanel() {
        let size = panel.frame.size

        // Preview builds are used for screenshots and can be launched while the
        // menu bar is crowded (the status item's window may not be on screen).
        if preview, let screen = NSScreen.main {
            let x = screen.frame.midX - size.width / 2
            let y = screen.frame.maxY - size.height - 42
            setPanelFrame(NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height))
            return
        }

        if model.panelPinned, let topLeft = model.savedPinnedOrigin {
            let screen = screenForPinnedAnchor(topLeft)
            var x = topLeft.x
            var y = topLeft.y - size.height
            if let visible = screen?.visibleFrame {
                x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
                if y < visible.minY + 8 { y = visible.minY + 8 }
                if y + size.height > visible.maxY - 4 { y = visible.maxY - 4 - size.height }
            }
            setPanelFrame(NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height))
            return
        }

        guard let button = statusItem.button else { return }
        let screen = button.window?.screen ?? NSScreen.main
        let visible = screen?.visibleFrame

        // A status item hidden by a menu-bar manager lives in a tiny off-screen
        // window at (0, -22). Its frame is non-empty, so also check that it is
        // actually up in the menu bar before trusting it.
        var anchorX: CGFloat?
        var anchorTop: CGFloat?
        if let window = button.window {
            let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
            let nearMenuBar = visible.map { rect.midY > $0.maxY - 40 && rect.midX > $0.minX && rect.midX < $0.maxX } ?? true
            if rect.width > 2, rect.height > 2, nearMenuBar {
                anchorX = rect.midX
                anchorTop = rect.minY
            }
        }

        // Fall back to the click position. If the accessibility click did not
        // move the pointer (or the item is hidden), use the top-right corner.
        if anchorX == nil {
            let mouse = NSEvent.mouseLocation
            if let visible = visible, mouse.y > visible.maxY - 40, mouse.x > visible.minX, mouse.x < visible.maxX {
                anchorX = mouse.x
            } else if let visible = visible {
                anchorX = visible.maxX - 120
            }
        }
        if anchorTop == nil { anchorTop = visible?.maxY }

        guard let ax = anchorX, let top = anchorTop else { return }
        var x = ax - size.width / 2
        var y = top - size.height - 6
        if let visible = visible {
            x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
            if y < visible.minY + 8 { y = visible.minY + 8 }
            if y + size.height > visible.maxY - 4 { y = visible.maxY - 4 - size.height }
        }
        setPanelFrame(NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height))
    }

    func showPanel(activate: Bool = true) {
        let restoredIcon = !statusItem.isVisible
        if restoredIcon {
            statusItem.isVisible = true
        }
        if panel.isVisible {
            // An explicit show request (the Obsidian command) only opens/focuses.
            panel.orderFrontRegardless()
            if activate {
                panel.makeKey()
                NSApp.activate(ignoringOtherApps: true)
            }
            return
        }

        layoutPanel()
        panel.alphaValue = 1
        // Put the panel on screen before asking macOS to activate the app. The
        // visual response should not wait for activation.
        panel.orderFrontRegardless()
        forceDisplay()
        model.panelVisible = true
        statusItem.button?.highlight(true)
        if !model.panelPinned {
            installMonitors()
            if restoredIcon {
                // Re-align once AppKit finishes placing the restored status item back into the menu bar.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in
                    guard let self = self, self.panel.isVisible, !self.model.panelPinned else { return }
                    self.layoutPanel()
                }
            }
        }
        if activate {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
        }
    }

    func forceDisplay() {
        hosting.frame = container.bounds
        hosting.needsLayout = true
        hosting.layoutSubtreeIfNeeded()
        panel.displayIfNeeded()
    }

    func hidePanel() {
        guard panel.isVisible else { return }
        model.panelVisible = false
        removeMonitors()
        statusItem.button?.highlight(false)
        panel.orderOut(nil)
        panel.alphaValue = 1
    }

    func installMonitors() {
        removeMonitors()
        let global = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] _ in
            DispatchQueue.main.async { self?.hidePanel() }
        }
        let local = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]
        ) { [weak self] event in
            guard let self = self else { return event }
            if event.type == .keyDown {
                if event.keyCode == 53 {
                    self.hidePanel()
                    return nil
                }
                return event
            }
            let point = NSEvent.mouseLocation
            if let button = self.statusItem.button, let window = button.window {
                let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
                if rect.contains(point) { return event }
            }
            if !self.panel.frame.contains(point) { self.hidePanel() }
            return event
        }
        monitors = [global, local].compactMap { $0 }
    }

    func removeMonitors() {
        for monitor in monitors {
            NSEvent.removeMonitor(monitor)
        }
        monitors.removeAll()
    }

    @objc func togglePanel() {
        if panel.isVisible {
            if !statusItem.isVisible {
                statusItem.isVisible = true
            }
            hidePanel()
        } else {
            showPanel()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
