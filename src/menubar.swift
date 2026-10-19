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
        default: return agentName
        }
    }
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
    let usage: String?
    let hotkey: String?
    let running: Int
    let waiting: Int
    let sessions: [MenuSession]
    let agents: [MenuAgent]?

    static let empty = MenuState(updatedAt: 0, short: "Agent Deck", summary: "等待 Agent Deck…", usage: nil, hotkey: nil, running: 0, waiting: 0, sessions: [], agents: [])

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
            .filter { !$0.isEmpty && !$0.contains("在跑") && !$0.contains("等你") }
        if parts.isEmpty {
            return summary.isEmpty ? "等待 Agent Deck…" : summary
        }
        return parts.joined(separator: " · ")
    }
}

final class MenuModel: ObservableObject {
    @Published var state: MenuState = .empty
    @Published var panelVisible = false
    let statePath: String
    let showPath: String
    let parentPid: Int32
    var timer: Timer?
    var onUpdate: (() -> Void)?
    var onShowRequest: (() -> Void)?
    private var lastShowAt = Date().timeIntervalSince1970

    init(statePath: String, parentPid: Int32) {
        self.statePath = statePath
        self.showPath = URL(fileURLWithPath: statePath)
            .deletingLastPathComponent()
            .appendingPathComponent("show-panel").path
        self.parentPid = parentPid
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
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
              let next = try? JSONDecoder().decode(MenuState.self, from: data) else { return }
        if next.updatedAt != state.updatedAt {
            state = next
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
    // Solid, near-white surfaces with a slight lavender tint so the panel sits
    // next to the light Obsidian theme instead of reading as parchment.
    static let panel = Color.solid("#F6F5FA", "#17161B")
    static let header = Color.solid("#EFEDF5", "#1E1D23")
    static let panelBorder = Color.solid("#D8D4E1", "#3A3742")

    static let card = Color.solid("#FFFFFF", "#242229")
    static let cardHover = Color.solid("#FDFCFF", "#2B2831")
    static let cardBorder = Color.solid("#E4E1EB", "#3A3742")
    static let cardBorderHover = Color.solid("#C9C4D6", "#595367")

    static let ink = Color.solid("#1B1A22", "#F6F3FA")
    static let secondary = Color.solid("#5F5C6B", "#B5B0BF")
    static let tertiary = Color.solid("#85818F", "#8C8896")
    static let divider = Color.solid("#E3E0EA", "#322F39")
    static let pill = Color.solid("#E7E4EE", "#2D2A33")
    static let brand = Color.solid("#4E43C8", "#7C6DFF")
    static let brandHover = Color.solid("#5B50D8", "#8E81FF")
    static let brandInk = Color.solid("#FFFFFF", "#171512")
}

// MARK: - TODOseq keywords

/// The keyword palette is lifted from the TODOseq plugin's local patch:
/// https://github.com/.../todoseq/styles.css ("关键词按状态上色").
/// Accent is the original colour; ink is a darkened variant for chip text so
/// small labels keep a readable contrast on the pale solid chip background.
struct KeywordStyle {
    let code: String
    let zh: String
    let accent: Color
    let ink: Color
    let tint: Color
    let icon: String
    let spins: Bool
}

enum DeckKeywords {
    static let doing = KeywordStyle(
        code: "DOING", zh: "在跑",
        accent: .solid("#C8635F", "#FF938B"),
        ink: .solid("#A34C48", "#FFB3AC"),
        tint: .solid("#F9E7E5", "#37211F"),
        icon: TsqIcons.doing, spins: true
    )

    static let needok = KeywordStyle(
        code: "NEEDOK?", zh: "等你",
        accent: .solid("#BF7A45", "#F2A66B"),
        ink: .solid("#96582B", "#FFC79A"),
        tint: .solid("#FBEDE1", "#3A281C"),
        icon: TsqIcons.needok, spins: false
    )

    static let waiting = KeywordStyle(
        code: "WAITING", zh: "等你",
        accent: .solid("#8F7FB6", "#BFAEEA"),
        ink: .solid("#6A5B92", "#D9CEFF"),
        tint: .solid("#F0EBF8", "#2A2438"),
        icon: TsqIcons.waiting, spins: false
    )

    static let paused = KeywordStyle(
        code: "PAUSED", zh: "安静",
        accent: .solid("#B39A3E", "#E4CB6A"),
        ink: .solid("#846F22", "#F2DF9B"),
        tint: .solid("#F7F0D9", "#332C18"),
        icon: TsqIcons.paused, spins: false
    )

    static let errored = KeywordStyle(
        code: "ERRORED", zh: "出错",
        accent: .solid("#93606B", "#E18C99"),
        ink: .solid("#70414B", "#F5B5BE"),
        tint: .solid("#F5E7E9", "#37222A"),
        icon: TsqIcons.errored, spins: false
    )

    static let hitlimit = KeywordStyle(
        code: "HITLIMIT!", zh: "限额",
        accent: .solid("#8A5A8C", "#CE93D2"),
        ink: .solid("#673A69", "#E8B9EB"),
        tint: .solid("#F4E8F4", "#332236"),
        icon: TsqIcons.hitlimit, spins: false
    )

    static let done = KeywordStyle(
        code: "DONE", zh: "完成",
        accent: .solid("#629C7F", "#83C9A5"),
        ink: .solid("#43705A", "#B1E5C9"),
        tint: .solid("#E8F3EC", "#1D3328"),
        icon: TsqIcons.done, spins: false
    )

    static let later = KeywordStyle(
        code: "LATER", zh: "最近",
        accent: .solid("#5C86B4", "#8FB8E8"),
        ink: .solid("#40658D", "#C2DFFF"),
        tint: .solid("#E9F0F9", "#1E2A38"),
        icon: TsqIcons.todo, spins: false
    )

    static let todo = KeywordStyle(
        code: "TODO", zh: "空闲",
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
                color: .solid("#D97757", "#F09475"),
                tint: .solid("#FBECE4", "#39251E"),
                glyph: "✳", short: "Claude"
            )
        case "codex":
            return AgentStyle(
                color: .solid("#4C82C3", "#7FB2E8"),
                tint: .solid("#EAF1F9", "#1E2C3B"),
                glyph: "⌘", short: "Codex"
            )
        case "workbuddy":
            return AgentStyle(
                color: .solid("#1C9A78", "#46C9A3"),
                tint: .solid("#E6F5EF", "#1B332B"),
                glyph: "✦", short: "WorkBuddy"
            )
        case "dsh":
            return AgentStyle(
                color: .solid("#4A66E8", "#7F95FF"),
                tint: .solid("#EAEDFF", "#232744"),
                glyph: "◈", short: "DSH"
            )
        default:
            let base = Color(hex: fallbackColor)
            return AgentStyle(
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
            Text(style.glyph)
                .font(.system(size: 9.5, weight: .bold))
                .foregroundColor(style.color)
            Text(agent.short.isEmpty ? style.short : agent.short)
                .font(.system(size: 9.5, weight: agent.primary ? .bold : .semibold))
                .foregroundColor(DeckPalette.ink)
                .lineLimit(1)
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
        .padding(.vertical, 3.5)
        .frame(maxWidth: .infinity)
        .background(Capsule(style: .continuous).fill(style.tint))
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(style.color.opacity(agent.primary ? 0.42 : 0.24), lineWidth: 1)
        )
        .help("跑 \(agent.running) · 等 \(agent.waiting)")
    }
}

struct HeaderBlock: View {
    let state: MenuState

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(DeckPalette.brand)
                    if let image = lucideImage(lucideWandSVG, 15) {
                        Image(nsImage: image)
                            .renderingMode(.template)
                            .foregroundColor(.white)
                    } else {
                        Image(systemName: "sparkles")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 30, height: 30)
                .shadow(color: DeckPalette.brand.opacity(0.35), radius: 6, x: 0, y: 2)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Agent Deck")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(DeckPalette.ink)
                    Text(state.usageLine)
                        .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                        .foregroundColor(DeckPalette.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                HStack(alignment: .top, spacing: 12) {
                    StatBlock(label: "DOING", value: state.running, style: DeckKeywords.doing)
                    StatBlock(label: "WAITING", value: state.waiting, style: DeckKeywords.waiting)
                }
            }

            if state.needsApproval > 0 {
                HStack(spacing: 5) {
                    KeywordGlyph(style: DeckKeywords.needok, size: 10)
                    Text("\(state.needsApproval) 个 NEEDOK? 需要你允许")
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
                        GridItem(.flexible(), spacing: 5),
                        GridItem(.flexible(), spacing: 5),
                    ],
                    spacing: 5
                ) {
                    ForEach(agents) { AgentPill(agent: $0) }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DeckPalette.header)
    }
}

// MARK: - Session list

struct SectionHeader: View {
    let title: String
    let subtitle: String
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(DeckPalette.brand)
                .frame(width: 3, height: 11)
            Text(title)
                .font(.system(size: 9.5, weight: .bold))
                .kerning(0.6)
                .foregroundColor(DeckPalette.secondary)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(DeckPalette.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text("\(count)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(DeckPalette.secondary)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Capsule(style: .continuous).fill(DeckPalette.pill))
        }
        .padding(.horizontal, 2)
        .padding(.top, 2)
    }
}

struct MetaText: View {
    let session: MenuSession
    let agent: AgentStyle

    var body: some View {
        HStack(spacing: 4) {
            if session.hasStructuredMeta {
                Text(session.shortAgent)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(agent.color)
                if let project = session.project, !project.isEmpty {
                    Text("·")
                        .foregroundColor(DeckPalette.tertiary)
                    Text(project)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DeckPalette.secondary)
                        .lineLimit(1)
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
    @State private var hovering = false

    var body: some View {
        let agent = DeckAgents.style(for: session)
        let keyword = DeckKeywords.style(for: session.keywordCode)
        Button(action: { openSession(session) }) {
            HStack(alignment: .center, spacing: 9) {
                AgentBadge(style: agent)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(session.displayTitle)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(DeckPalette.ink)
                            .lineLimit(1)
                            .help(session.title)
                        Spacer(minLength: 4)
                        KeywordChip(style: keyword)
                    }
                    MetaText(session: session, agent: agent)
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 10)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(hovering ? DeckPalette.cardHover : DeckPalette.card)
            )
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(keyword.accent)
                    .frame(width: 3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(hovering ? DeckPalette.cardBorderHover : DeckPalette.cardBorder, lineWidth: 1)
            )
            .shadow(
                color: Color.black.opacity(hovering ? 0.18 : 0.10),
                radius: hovering ? 8 : 5,
                x: 0,
                y: hovering ? 4 : 2
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.12)) { hovering = inside }
        }
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
                Text("现在没有要显示的会话")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(DeckPalette.ink)
            }
            Text("主力 Agent 的会话会留在这里；其它 Agent 只在正在运行时出现，WorkBuddy 的等待会话也列。")
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
    let state: MenuState

    var body: some View {
        let primary = state.sessions.filter { $0.primary }
        let others = state.sessions.filter { !$0.primary }

        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(alignment: .leading, spacing: 8) {
                if !primary.isEmpty {
                    SectionHeader(title: "主力 AGENT", subtitle: "全量追踪", count: primary.count)
                    ForEach(primary) { SessionCardView(session: $0) }
                }
                if !others.isEmpty {
                    SectionHeader(title: "其它 AGENT", subtitle: "在跑 · WorkBuddy 等你", count: others.count)
                        .padding(.top, 4)
                    ForEach(others) { SessionCardView(session: $0) }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 11)
            .padding(.bottom, 14)
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
                .padding(.horizontal, kind == .quiet ? 6 : 10)
                .padding(.vertical, kind == .quiet ? 4 : 6)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(border, lineWidth: 1)
                )
                .shadow(
                    color: kind == .primary ? DeckPalette.brand.opacity(0.32) : .clear,
                    radius: 5,
                    x: 0,
                    y: 2
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
        case .primary:
            return DeckPalette.brandInk
        case .secondary:
            return DeckPalette.ink
        case .quiet:
            return hovering ? DeckPalette.ink : DeckPalette.secondary
        }
    }

    private var background: Color {
        switch kind {
        case .primary:
            return hovering ? DeckPalette.brandHover : DeckPalette.brand
        case .secondary:
            return hovering ? DeckPalette.cardHover : DeckPalette.card
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
        if sessionCount == 0 { return "等待 Agent 会话" }
        return sessionCount > 5 ? "共 \(sessionCount) 个 · 向下滑动" : "点击卡片跳转"
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(hint)
                .font(.system(size: 9))
                .foregroundColor(DeckPalette.tertiary)
                .lineLimit(1)
            FooterButton(title: "打开面板", kind: .primary) {
                adOpen("obsidian://agent-deck")
            }
            FooterButton(title: "重新扫描", kind: .secondary) {
                adOpen("obsidian://agent-deck?do=scan")
            }
            Spacer(minLength: 4)
            FooterButton(title: "隐藏", kind: .quiet) {
                adOpen("obsidian://agent-deck?do=hide")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(DeckPalette.header)
    }
}

// MARK: - Root

struct DeckView: View {
    @ObservedObject var model: MenuModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBlock(state: model.state)
            Hairline()
            if model.state.sessions.isEmpty {
                EmptyState()
            } else {
                SessionListView(state: model.state)
                    .frame(maxHeight: .infinity)
            }
            Hairline()
            FooterBlock(sessionCount: model.state.sessions.count)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(DeckPalette.panel)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DeckPalette.panelBorder, lineWidth: 1)
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
    delegate.showPanel()
    return noErr
}

final class AppDelegate: NSObject, NSApplicationDelegate {
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

    let panelWidth: CGFloat = 412

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
        statusItem.isVisible = true
        if let button = statusItem.button {
            if let image = lucideImage(lucideWandSVG, 18) {
                button.image = image
            } else {
                let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Agent Deck")
                image?.isTemplate = true
                button.image = image
            }
            button.imagePosition = .imageLeading
            button.title = " Agent Deck"
            button.font = NSFont.systemFont(ofSize: 11, weight: .medium)
            button.target = self
            button.action = #selector(togglePanel)
        }

        hostPanel()
        if !preview { installHotKeyHandler() }

        dismissObserver = NotificationCenter.default.addObserver(
            forName: .agentDeckDismiss, object: nil, queue: .main
        ) { [weak self] _ in
            self?.hidePanel()
        }

        model.onUpdate = { [weak self] in self?.refresh() }
        model.onShowRequest = { [weak self] in self?.showPanel() }
        model.start()
        refresh()
        forceDisplay()
        // Write the pid file only after lastShowAt has been recorded, so an
        // Obsidian command that waits for this pid cannot race the listener.
        if !pidPath.isEmpty {
            try? "\(getpid())".write(toFile: pidPath, atomically: true, encoding: .utf8)
        }

        if preview {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                self?.showPanel()
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
        panel.contentView = container
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    }

    func refresh() {
        let short = model.state.short.trimmingCharacters(in: .whitespacesAndNewlines)
        statusItem.button?.title = short.isEmpty ? " Agent Deck" : " " + short

        let height = panelHeightForScreen()
        let resized = abs(panel.frame.height - height) > 0.5
        if resized {
            panel.setContentSize(NSSize(width: panelWidth, height: height))
        }
        if panel.isVisible {
            layoutPanel()
            if resized { forceDisplay() }
        }
        if hotKeyHandler != nil {
            applyHotKey(model.state.hotkey)
        }
    }

    func panelHeightForScreen() -> CGFloat {
        let desired = desiredHeight()
        if let screen = statusItem.button?.window?.screen ?? NSScreen.main {
            return min(desired, screen.visibleFrame.height - 16)
        }
        return desired
    }

    /// Keep this roughly in sync with the SwiftUI blocks above: a fixed header,
    /// a scrollable card area and a fixed footer. At most five cards are shown
    /// before scrolling; the body ends exactly at the fifth card so a sixth card
    /// never peeks through, while its shadow still has a little room.
    func desiredHeight() -> CGFloat {
        let sessions = model.state.sessions
        if sessions.isEmpty { return 300 }

        let shown = min(5, sessions.count)
        let prefix = sessions.prefix(shown)
        let hasPrimary = prefix.contains { $0.primary }
        let hasOthers = prefix.contains { !$0.primary }

        let agentRows = max(1, ((model.state.agents?.count ?? 0) + 1) / 2)
        let headerBlock: CGFloat = 85 + CGFloat(agentRows - 1) * 23 + (model.state.needsApproval > 0 ? 29 : 0)
        let footer: CGFloat = 49

        var sectionHeaders: CGFloat = 0
        if hasPrimary { sectionHeaders += 15 }
        if hasOthers { sectionHeaders += hasPrimary ? 19 : 15 }

        // LazyVStack spacing sits between every block: headers, cards, headers.
        let sections = (hasPrimary ? 1 : 0) + (hasOthers ? 1 : 0)
        let gaps = sections + shown - 1
        let body = 11 + sectionHeaders + CGFloat(gaps) * 8 + CGFloat(shown) * 58 + 2
        return headerBlock + body + footer + 2
    }

    func layoutPanel() {
        let size = panel.frame.size

        // Preview builds are used for screenshots and can be launched while the
        // menu bar is crowded (the status item's window may not be on screen).
        if preview, let screen = NSScreen.main {
            let x = screen.frame.midX - size.width / 2
            let y = screen.frame.maxY - size.height - 42
            panel.setFrame(NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height), display: true)
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
        panel.setFrame(
            NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height),
            display: true
        )
    }

    func showPanel() {
        if panel.isVisible {
            // The shortcut always opens/focuses; it never closes the panel.
            panel.orderFrontRegardless()
            panel.makeKey()
            NSApp.activate(ignoringOtherApps: true)
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
        installMonitors()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
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
