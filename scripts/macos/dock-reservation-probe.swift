import AppKit
import ApplicationServices
import Foundation

// A bounded experiment, not a system work-area registration. AX and NSScreen use points;
// PLVS's persisted physical-pixel window bounds must never be passed to this tool directly.
struct ProbeError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

struct Rect: Codable, Equatable {
  var x: Double
  var y: Double
  var width: Double
  var height: Double
  init(_ rect: CGRect) {
    x = rect.minX
    y = rect.minY
    width = rect.width
    height = rect.height
  }
  var cg: CGRect { CGRect(x: x, y: y, width: width, height: height) }
  func matches(_ other: Rect) -> Bool {
    abs(x - other.x) <= 1 && abs(y - other.y) <= 1
      && abs(width - other.width) <= 1 && abs(height - other.height) <= 1
  }
}

struct Journal: Codable {
  let pid: Int32
  let launchedAt: Date
  let title: String
  let before: Rect
  let proposed: Rect
  // Written before mutation. Restore checks these actual intermediate geometries as well,
  // because an application can accept resizing but refuse moving (or vice versa).
  var observed: Rect?
  var phase: String
}

func emit<T: Encodable>(_ value: T) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  print(String(decoding: try encoder.encode(value), as: UTF8.self))
}

func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef {
  var result: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name as CFString, &result)
  guard error == .success, let result else {
    throw ProbeError("Read \(name): AX error \(error.rawValue)")
  }
  return result
}

func windows(_ pid: Int32) throws -> [AXUIElement] {
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 2)
  guard let result = try attribute(app, kAXWindowsAttribute) as? [AXUIElement] else {
    throw ProbeError("Application did not expose its windows")
  }
  return result
}

func title(_ window: AXUIElement) -> String {
  (try? attribute(window, kAXTitleAttribute) as? String) ?? ""
}

func geometry(_ window: AXUIElement) throws -> Rect {
  let position = try attribute(window, kAXPositionAttribute)
  let size = try attribute(window, kAXSizeAttribute)
  guard CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
    throw ProbeError("Window has invalid geometry attributes")
  }
  var point = CGPoint.zero
  var dimensions = CGSize.zero
  guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
    AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
  else {
    throw ProbeError("Window geometry could not be decoded")
  }
  return Rect(CGRect(origin: point, size: dimensions))
}

func requireWritable(_ window: AXUIElement) throws {
  guard (try attribute(window, kAXSubroleAttribute) as? String) == kAXStandardWindowSubrole else {
    throw ProbeError("Only standard application windows are eligible")
  }
  if (try? attribute(window, "AXFullScreen") as? Bool) == true {
    throw ProbeError("Full-screen windows are outside this experiment")
  }
  if (try? attribute(window, kAXMinimizedAttribute) as? Bool) == true {
    throw ProbeError("Minimized windows are outside this experiment")
  }
  for name in [kAXPositionAttribute, kAXSizeAttribute] {
    var settable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(window, name as CFString, &settable) == .success,
      settable.boolValue
    else { throw ProbeError("\(name) is not writable") }
  }
}

func setGeometry(_ window: AXUIElement, _ rect: Rect) throws {
  var size = rect.cg.size
  var position = rect.cg.origin
  guard let sizeValue = AXValueCreate(.cgSize, &size),
    let positionValue = AXValueCreate(.cgPoint, &position)
  else {
    throw ProbeError("Could not encode window geometry")
  }
  let resized = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
  guard resized == .success else { throw ProbeError("Resize: AX error \(resized.rawValue)") }
  let moved = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, positionValue)
  guard moved == .success else { throw ProbeError("Move: AX error \(moved.rawValue)") }
  // AppKit may clamp growth against the screen edge before the move frees room.
  // One bounded correction after moving handles that without a resize feedback loop.
  if try !geometry(window).matches(rect) {
    let corrected = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
    guard corrected == .success else {
      throw ProbeError("Correct resize: AX error \(corrected.rawValue)")
    }
    let repositioned = AXUIElementSetAttributeValue(
      window, kAXPositionAttribute as CFString, positionValue)
    guard repositioned == .success else {
      throw ProbeError("Correct move: AX error \(repositioned.rawValue)")
    }
  }
}

func axRect(_ cocoa: CGRect, primaryTop: Double) -> CGRect {
  CGRect(x: cocoa.minX, y: primaryTop - cocoa.maxY, width: cocoa.width, height: cocoa.height)
}

func fit(_ window: CGRect, inside workArea: CGRect, edge: String, height: Double) throws -> Rect {
  guard height.isFinite, height >= 56, height <= 160, workArea.height > height else {
    throw ProbeError("Height must be 56–160 points and leave room on the monitor")
  }
  guard edge == "top" || edge == "bottom" else { throw ProbeError("Edge must be top or bottom") }
  let available = CGRect(
    x: workArea.minX,
    y: workArea.minY + (edge == "top" ? height : 0),
    width: workArea.width, height: workArea.height - height)
  let width = min(window.width, available.width)
  let h = min(window.height, available.height)
  return Rect(
    CGRect(
      x: min(max(window.minX, available.minX), available.maxX - width),
      y: min(max(window.minY, available.minY), available.maxY - h), width: width, height: h))
}

func writeJournal(_ journal: Journal, to path: String) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  try encoder.encode(journal).write(to: URL(fileURLWithPath: path), options: .atomic)
}

func requireTrust() throws {
  guard AXIsProcessTrusted() else {
    throw ProbeError(
      "Accessibility permission is required. status does not request permission; use request-permission explicitly."
    )
  }
}

func appIdentity(_ pid: Int32) throws -> NSRunningApplication {
  guard let app = NSRunningApplication(processIdentifier: pid), app.launchDate != nil else {
    throw ProbeError("Target process is not a running macOS application with a known launch time")
  }
  guard pid != getpid(), !(app.bundleIdentifier ?? "").hasPrefix("com.soundoer.plvs") else {
    throw ProbeError("Choose a test host application, not PLVS or this probe")
  }
  return app
}

func selfTest() throws {
  let primary = CGRect(x: 0, y: 0, width: 1440, height: 900)
  guard axRect(primary, primaryTop: 900) == primary,
    axRect(CGRect(x: -1280, y: 900, width: 1280, height: 1024), primaryTop: 900).minY == -1024
  else {
    throw ProbeError("Multi-monitor coordinate conversion failed")
  }
  let work = CGRect(x: -1280, y: -1000, width: 1280, height: 950)
  let top = try fit(work, inside: work, edge: "top", height: 56)
  let bottom = try fit(work, inside: work, edge: "bottom", height: 160)
  guard top.y == -944, top.height == 894, bottom.y == -1000, bottom.height == 790,
    try fit(
      CGRect(x: -1100, y: -800, width: 300, height: 200), inside: work, edge: "top", height: 56
    ).cg
      == CGRect(x: -1100, y: -800, width: 300, height: 200)
  else {
    throw ProbeError("Edge reservation geometry failed")
  }
  for invalid in [Double.nan, -1, 0, 55, 161] {
    do { _ = try fit(work, inside: work, edge: "top", height: invalid) } catch { continue }
    throw ProbeError("Invalid height was accepted")
  }
  try emit(["ok": true, "geometryChecksPassed": true])
}

func run() throws {
  _ = NSApplication.shared
  let args = Array(CommandLine.arguments.dropFirst())
  let command = args.first ?? "status"
  let allowed: Set<String>
  switch command {
  case "status", "request-permission", "self-test": allowed = []
  case "list": allowed = ["--pid"]
  case "plan": allowed = ["--pid", "--window", "--edge", "--height"]
  case "apply": allowed = ["--pid", "--window", "--edge", "--height", "--journal"]
  case "restore": allowed = ["--journal"]
  default: throw ProbeError("Unknown command: \(command)")
  }
  var seen = Set<String>()
  var argumentIndex = 1
  while argumentIndex < args.count {
    let name = args[argumentIndex]
    guard allowed.contains(name), seen.insert(name).inserted,
      argumentIndex + 1 < args.count, !args[argumentIndex + 1].hasPrefix("--")
    else {
      throw ProbeError("Unknown, repeated, or incomplete option: \(name)")
    }
    argumentIndex += 2
  }
  func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
  }
  if command == "self-test" {
    try selfTest()
    return
  }
  if command == "status" || command == "request-permission" {
    if command == "request-permission" {
      _ = AXIsProcessTrustedWithOptions(
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }
    try emit([
      "trusted": AXIsProcessTrusted(), "permissionRequested": command == "request-permission",
    ])
    return
  }
  try requireTrust()
  if command == "list" {
    guard let text = option("--pid"), let pid = Int32(text) else {
      throw ProbeError("list requires --pid")
    }
    _ = try appIdentity(pid)
    struct WindowInfo: Encodable {
      let index: Int
      let title: String
      let frame: Rect
    }
    let items = try windows(pid).enumerated().map { index, window in
      WindowInfo(index: index, title: title(window), frame: try geometry(window))
    }
    try emit(items)
    return
  }
  if command == "restore" {
    guard let path = option("--journal") else { throw ProbeError("restore requires --journal") }
    var journal = try JSONDecoder().decode(
      Journal.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let app = try appIdentity(journal.pid)
    guard app.launchDate == journal.launchedAt else {
      throw ProbeError("Target process changed; refusing restore")
    }
    guard journal.phase != "restored" else {
      try emit(journal)
      return
    }
    let expected = journal.observed ?? journal.proposed
    let candidates = try windows(journal.pid).filter {
      title($0) == journal.title && ((try? geometry($0).matches(expected)) ?? false)
    }
    guard candidates.count == 1 else {
      throw ProbeError(
        "Window moved, closed, or is ambiguous; refusing restore to preserve user changes")
    }
    let window = candidates[0]
    try requireWritable(window)
    do {
      try setGeometry(window, journal.before)
      Thread.sleep(forTimeInterval: 0.2)
      journal.observed = try geometry(window)
      guard journal.observed!.matches(journal.before) else {
        throw ProbeError("Host did not restore the requested geometry; journal retained")
      }
    } catch {
      journal.observed = try? geometry(window)
      journal.phase = "restorePartialFailure"
      try writeJournal(journal, to: path)
      throw error
    }
    journal.phase = "restored"
    try writeJournal(journal, to: path)
    try emit(journal)
    return
  }
  guard command == "plan" || command == "apply",
    let pidText = option("--pid"), let pid = Int32(pidText),
    let windowText = option("--window"), let index = Int(windowText), index >= 0
  else {
    throw ProbeError(
      "Use plan|apply --pid <pid> --window <index> [--edge top|bottom] [--height 56..160]; apply also requires --journal <new-file>"
    )
  }
  let app = try appIdentity(pid)
  let list = try windows(pid)
  guard index < list.count else {
    throw ProbeError("Window index out of range (\(list.count) windows)")
  }
  let window = list[index]
  try requireWritable(window)
  let before = try geometry(window)
  guard let primary = NSScreen.screens.first,
    let screen = NSScreen.screens.max(by: {
      axRect($0.frame, primaryTop: primary.frame.maxY).intersection(before.cg).area
        < axRect($1.frame, primaryTop: primary.frame.maxY).intersection(before.cg).area
    }), axRect(screen.frame, primaryTop: primary.frame.maxY).intersects(before.cg)
  else {
    throw ProbeError("No monitor intersects the target window")
  }
  let heightText = option("--height") ?? "56"
  guard let height = Double(heightText) else { throw ProbeError("Height must be a number") }
  let proposed = try fit(
    before.cg, inside: axRect(screen.visibleFrame, primaryTop: primary.frame.maxY),
    edge: option("--edge") ?? "top", height: height)
  var journal = Journal(
    pid: pid, launchedAt: app.launchDate!, title: title(window), before: before,
    proposed: proposed, observed: nil, phase: "planned")
  if command == "plan" {
    try emit(journal)
    return
  }
  guard let path = option("--journal"), !FileManager.default.fileExists(atPath: path) else {
    throw ProbeError("apply requires --journal pointing to a new file")
  }
  // Refuse stale geometry before any external-window write. Keep recovery data even on partial failure.
  guard try geometry(window).matches(before) else {
    throw ProbeError("Window moved while planning; run plan again")
  }
  try writeJournal(journal, to: path)
  do {
    try setGeometry(window, proposed)
    Thread.sleep(forTimeInterval: 0.2)
    journal.observed = try geometry(window)
    journal.phase = journal.observed!.matches(proposed) ? "applied" : "hostAdjusted"
    try writeJournal(journal, to: path)
    try emit(journal)
  } catch {
    journal.observed = try? geometry(window)
    journal.phase = "partialFailure"
    try writeJournal(journal, to: path)
    throw error
  }
}

extension CGRect {
  var area: Double { isNull ? 0 : width * height }
}

do { try run() } catch {
  struct Failure: Encodable {
    let ok = false
    let error: String
  }
  try? emit(Failure(error: String(describing: error)))
  exit(1)
}
