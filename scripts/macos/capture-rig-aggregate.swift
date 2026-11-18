import CoreAudio
import Foundation

let prefix = "com.soundoer.plvs.reconnect."

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func outputDevice(for uid: String) -> AudioObjectID {
  var qualifier = uid as CFString
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var device = AudioObjectID(kAudioObjectUnknown)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  let status = withUnsafePointer(to: &qualifier) {
    AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject), &address,
      UInt32(MemoryLayout<CFString>.size), $0, &size, &device
    )
  }
  guard status == noErr else { fail("Could not resolve the test device UID (\(status)).") }
  return device
}

let args = CommandLine.arguments
guard args.count >= 3, args[2].hasPrefix(prefix),
      let token = UUID(uuidString: String(args[2].dropFirst(prefix.count))) else {
  fail("Expected an owned PLVS reconnect device UID.")
}
let uid = args[2]
switch args[1] {
case "create":
  guard args.count == 4 else { fail("Expected a BlackHole subdevice UID.") }
  guard outputDevice(for: uid) == kAudioObjectUnknown else { fail("Test device already exists.") }
  let subdevice = args[3]
  let details: [String: Any] = [
    kAudioAggregateDeviceNameKey: "PLVS Reconnect " + String(token.uuidString.suffix(8)),
    kAudioAggregateDeviceUIDKey: uid,
    kAudioAggregateDeviceMainSubDeviceKey: subdevice,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: subdevice]],
    kAudioAggregateDeviceIsPrivateKey: false,
  ]
  var device = AudioObjectID(kAudioObjectUnknown)
  let status = AudioHardwareCreateAggregateDevice(details as CFDictionary, &device)
  guard status == noErr else { fail("Could not create the test aggregate (\(status)).") }
case "destroy":
  guard args.count == 3 else { fail("Expected only the owned test device UID.") }
  // Resolve the current object ID, which may change after the creator exits.
  let device = outputDevice(for: uid)
  if device != kAudioObjectUnknown {
    let status = AudioHardwareDestroyAggregateDevice(device)
    guard status == noErr else { fail("Could not remove the test aggregate (\(status)).") }
  }
default:
  fail("Expected create or destroy.")
}
