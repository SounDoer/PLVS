import CoreAudio
import Foundation

func propertyAddress(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope)
  -> AudioObjectPropertyAddress
{
  AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: scope,
    mElement: kAudioObjectPropertyElementMain
  )
}

func stringProperty(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var address = propertyAddress(selector, kAudioObjectPropertyScopeGlobal)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value)
  return status == noErr ? value?.takeUnretainedValue() as String? : nil
}

func nominalSampleRate(_ device: AudioObjectID) -> Double? {
  var address = propertyAddress(kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal)
  var value = 0.0
  var size = UInt32(MemoryLayout<Double>.size)
  let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value)
  return status == noErr ? value : nil
}

func outputChannelCount(_ device: AudioObjectID) -> UInt32? {
  var address = propertyAddress(
    kAudioDevicePropertyStreamConfiguration,
    kAudioDevicePropertyScopeOutput
  )
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr else {
    return nil
  }
  let storage = UnsafeMutableRawPointer.allocate(
    byteCount: Int(size),
    alignment: MemoryLayout<AudioBufferList>.alignment
  )
  defer { storage.deallocate() }
  let list = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
  guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, list) == noErr else {
    return nil
  }
  return UnsafeMutableAudioBufferListPointer(list).reduce(0) {
    $0 + $1.mNumberChannels
  }
}

func audioDevices() throws -> [AudioObjectID] {
  var address = propertyAddress(kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(
    AudioObjectID(kAudioObjectSystemObject),
    &address,
    0,
    nil,
    &size
  ) == noErr else {
    throw NSError(domain: "PLVSCaptureRig", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Core Audio did not return its device-list size."
    ])
  }
  var devices = Array(
    repeating: AudioObjectID(0),
    count: Int(size) / MemoryLayout<AudioObjectID>.size
  )
  let status = devices.withUnsafeMutableBytes { bytes in
    AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      0,
      nil,
      &size,
      bytes.baseAddress!
    )
  }
  guard status == noErr else {
    throw NSError(domain: "PLVSCaptureRig", code: 2, userInfo: [
      NSLocalizedDescriptionKey: "Core Audio did not return its device list."
    ])
  }
  return devices
}

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(Data("Usage: core-audio-output.swift <device-name>\n".utf8))
  exit(2)
}

do {
  let expectedName = CommandLine.arguments[1]
  let matches: [[String: Any]] = try audioDevices().compactMap { device in
    guard
      stringProperty(device, kAudioObjectPropertyName) == expectedName,
      let channels = outputChannelCount(device),
      channels > 0
    else {
      return nil
    }
    return [
      "audioObjectId": device,
      "name": expectedName,
      "uid": stringProperty(device, kAudioDevicePropertyDeviceUID) ?? "",
      "outputChannelCount": channels,
      "nominalSampleRateHz": nominalSampleRate(device) ?? 0,
    ]
  }
  let encoded = try JSONSerialization.data(withJSONObject: ["devices": matches])
  FileHandle.standardOutput.write(encoded)
  FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
  FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
  exit(1)
}
