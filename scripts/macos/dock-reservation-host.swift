import AppKit
import Foundation

// Disposable test application. Commands affect only the window this process owns.
// It reports NSWindow's frame independently of the probe's AX reads.
final class Host: NSObject, NSApplicationDelegate, NSWindowDelegate {
  var window: NSWindow!
  var timer: Timer?
  var lastCommand = ""
  let state: URL
  let control: URL
  let started = Date()

  init(state: URL, control: URL) {
    self.state = state
    self.control = control
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    guard let screen = NSScreen.screens.first else {
      NSApp.terminate(nil)
      return
    }
    window = NSWindow(
      contentRect: screen.visibleFrame,
      styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered, defer: false)
    window.title = "Dock Reservation Disposable Host"
    window.isReleasedWhenClosed = false
    window.delegate = self
    let label = NSTextField(
      wrappingLabelWithString:
        "Disposable Dock reservation test window\nNo documents or user data are loaded.")
    label.frame = NSRect(x: 32, y: 32, width: 500, height: 80)
    window.contentView?.addSubview(label)
    reset()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    report()
    timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      self?.tick()
    }
  }

  func reset() {
    window.deminiaturize(nil)
    window.minSize = NSSize(width: 200, height: 150)
    window.setFrame(window.screen?.visibleFrame ?? NSScreen.screens[0].visibleFrame, display: true)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func tick() {
    // Avoid leaving an experimental process running indefinitely after a failed harness.
    if Date().timeIntervalSince(started) > 600 {
      NSApp.terminate(nil)
      return
    }
    guard let data = try? Data(contentsOf: control),
      let command = try? JSONDecoder().decode(Command.self, from: data),
      command.id != lastCommand
    else { return }
    lastCommand = command.id
    switch command.action {
    case "reset": reset()
    case "compact":
      reset()
      let frame = window.frame
      window.setFrame(
        NSRect(x: frame.midX - 200, y: frame.midY - 150, width: 400, height: 300), display: true)
    case "minimum":
      reset()
      window.minSize = window.frame.size
    case "move":
      window.setFrameOrigin(NSPoint(x: window.frame.minX + 20, y: window.frame.minY + 20))
    case "minimize": window.miniaturize(nil)
    case "quit": NSApp.terminate(nil)
    default: break
    }
    report()
  }

  func report() {
    guard let window, let primary = NSScreen.screens.first else { return }
    let frame = window.frame
    let value = State(
      pid: getpid(), command: lastCommand, minimized: window.isMiniaturized,
      frame: Frame(
        x: frame.minX, y: primary.frame.maxY - frame.maxY,
        width: frame.width, height: frame.height))
    do {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(value).write(to: state, options: .atomic)
    } catch { fputs("Host state write failed: \(error)\n", stderr) }
  }

  func windowDidMove(_ notification: Notification) { report() }
  func windowDidResize(_ notification: Notification) { report() }
  func windowDidMiniaturize(_ notification: Notification) { report() }
  func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }
}

struct Command: Decodable {
  let id: String
  let action: String
}
struct Frame: Encodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}
struct State: Encodable {
  let pid: Int32
  let command: String
  let minimized: Bool
  let frame: Frame
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 4, arguments[0] == "--state", arguments[2] == "--control",
  arguments[1] != arguments[3]
else {
  fputs("Use test-host --state <new-state-file> --control <command-file>\n", stderr)
  exit(1)
}
guard !FileManager.default.fileExists(atPath: arguments[1]) else {
  fputs("State file must be new\n", stderr)
  exit(1)
}
let app = NSApplication.shared
let host = Host(
  state: URL(fileURLWithPath: arguments[1]), control: URL(fileURLWithPath: arguments[3]))
app.delegate = host
app.setActivationPolicy(.regular)
app.run()
