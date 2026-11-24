// A regular GUI application with a unique bundle identity and an explicit test output.
import AppKit
import AVFoundation
import AudioToolbox

guard CommandLine.arguments.count == 3, let device = UInt32(CommandLine.arguments[1]) else {
    fputs("Usage: source-mix-player <Core Audio device object ID> <PCM WAV>\n", stderr)
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let engine = AVAudioEngine()
guard let output = engine.outputNode.audioUnit else {
    fputs("No audio output unit.\n", stderr)
    exit(1)
}
var deviceID = device
let status = AudioUnitSetProperty(
    output, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
    &deviceID, UInt32(MemoryLayout<UInt32>.size)
)
guard status == noErr else {
    fputs("Could not set the test output: \(status).\n", stderr)
    exit(1)
}
let player = AVAudioPlayerNode()
let file = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[2]))
engine.attach(player)
engine.connect(player, to: engine.mainMixerNode, format: file.processingFormat)
engine.prepare()
try engine.start()
player.scheduleFile(file, at: nil)
player.play()
app.run()
