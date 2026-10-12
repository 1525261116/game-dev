// vprobe.swift — macOS AVFoundation 视频探测/抽帧工具（无 ffmpeg 环境下的替代方案）
// 用法:
//   vprobe info <video>
//   vprobe frames <video> <outDir> <count> [maxWidth]
//   vprobe range <video> <outDir> <start> <end> <fps> [maxWidth]
//   vprobe pcm <video> <outPath>   (32-bit float mono PCM raw)
import Foundation
import AVFoundation
import AppKit

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: vprobe <info|frames|range|pcm> ...") }
let cmd = args[1]

func loadAsset(_ path: String) -> AVURLAsset {
    let url = URL(fileURLWithPath: path)
    return AVURLAsset(url: url)
}

func jsonEscape(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
}

func info(_ path: String) {
    let asset = loadAsset(path)
    let dur = CMTimeGetSeconds(asset.duration)
    var out: [String] = []
    out.append("{\"duration\": \(dur),")
    out.append("\"tracks\": [")
    var first = true
    for track in asset.tracks {
        var fields: [String] = []
        let mt = track.mediaType.rawValue
        fields.append("\"mediaType\": \"\(mt)\"")
        fields.append("\"nominalFrameRate\": \(track.nominalFrameRate)")
        fields.append("\"naturalSize\": {\"w\": \(track.naturalSize.width), \"h\": \(track.naturalSize.height)}")
        fields.append("\"preferredTransform\": [\(track.preferredTransform.a), \(track.preferredTransform.b), \(track.preferredTransform.c), \(track.preferredTransform.d), \(track.preferredTransform.tx), \(track.preferredTransform.ty)]")
        fields.append("\"timeRange\": {\"start\": \(CMTimeGetSeconds(track.timeRange.start)), \"duration\": \(CMTimeGetSeconds(track.timeRange.duration))}")
        if let descs = track.formatDescriptions as? [CMFormatDescription] {
            var ds: [String] = []
            for d in descs {
                let sub = CMFormatDescriptionGetMediaSubType(d)
                let chars = [UInt8((sub >> 24) & 0xFF), UInt8((sub >> 16) & 0xFF), UInt8((sub >> 8) & 0xFF), UInt8(sub & 0xFF)]
                let fourcc = String(bytes: chars, encoding: .ascii) ?? "?"
                var s = "\"fourcc\": \"\(fourcc)\""
                let dims = CMVideoFormatDescriptionGetDimensions(d)
                s += ", \"dims\": {\"w\": \(dims.width), \"h\": \(dims.height)}"
                if let ext = CMFormatDescriptionGetExtensions(d) as? [String: Any] {
                    if let depth = ext["BitDepth"] { s += ", \"bitDepth\": \(depth)" }
                    if let fld = ext["FieldCount"] { s += ", \"fieldCount\": \(fld)" }
                }
                ds.append("{\(s)}")
            }
            fields.append("\"formats\": [\(ds.joined(separator: ","))]")
        }
        if track.mediaType == .audio {
            fields.append("\"audioChannelCount\": \(track.naturalTimeScale)")
            let ad = track.formatDescriptions.first
            if let ad = ad {
                let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(ad)
                if let asbd = asbd {
                    fields.append("\"sampleRate\": \(asbd.pointee.mSampleRate)")
                    fields.append("\"channels\": \(asbd.pointee.mChannelsPerFrame)")
                    fields.append("\"bitsPerChannel\": \(asbd.pointee.mBitsPerChannel)")
                }
            }
            fields.append("\"estimatedDataRate\": \(track.estimatedDataRate)")
        }
        out.append((first ? "" : ",") + "{" + fields.joined(separator: ", ") + "}")
        first = false
    }
    out.append("]}")
    print(out.joined(separator: "\n"))
}

func makeGenerator(_ asset: AVURLAsset, maxWidth: CGFloat) -> AVAssetImageGenerator {
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    if maxWidth > 0 {
        gen.maximumSize = CGSize(width: maxWidth, height: maxWidth * 4)
    }
    return gen
}

func saveFrame(_ cg: CGImage, to path: String, quality: CGFloat) {
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else { return }
    try? data.write(to: URL(fileURLWithPath: path))
}

func timeString(_ t: Double) -> String {
    return String(format: "%.3f", t)
}

func extractRange(_ path: String, outDir: String, start: Double, end: Double, fps: Double, maxWidth: CGFloat) {
    let asset = loadAsset(path)
    let gen = makeGenerator(asset, maxWidth: maxWidth)
    try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    var t = start
    let step = 1.0 / fps
    var idx = 0
    var manifest: [String] = []
    while t <= end + 1e-6 {
        let time = CMTime(seconds: t, preferredTimescale: 60000)
        do {
            let cg = try gen.copyCGImage(at: time, actualTime: nil)
            let name = String(format: "f%04d_%s.jpg", idx, timeString(t))
            saveFrame(cg, to: outDir + "/" + name, quality: 0.9)
            manifest.append("{\"file\": \"\(name)\", \"t\": \(timeString(t))}")
        } catch {
            // 该时间点取帧失败，跳过
        }
        idx += 1
        t += step
    }
    print("[" + manifest.joined(separator: ",") + "]")
}

func extractCount(_ path: String, outDir: String, count: Int, maxWidth: CGFloat) {
    let asset = loadAsset(path)
    let dur = CMTimeGetSeconds(asset.duration)
    let gen = makeGenerator(asset, maxWidth: maxWidth)
    try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    var manifest: [String] = []
    for i in 0..<count {
        let t = dur * Double(i) / Double(max(count - 1, 1))
        let time = CMTime(seconds: min(t, max(dur - 0.05, 0)), preferredTimescale: 60000)
        do {
            let cg = try gen.copyCGImage(at: time, actualTime: nil)
            let name = String(format: "f%04d_%s.jpg", i, timeString(t))
            saveFrame(cg, to: outDir + "/" + name, quality: 0.9)
            manifest.append("{\"file\": \"\(name)\", \"t\": \(timeString(t))}")
        } catch {
        }
    }
    print("[" + manifest.joined(separator: ",") + "]")
}

func extractPCM(_ path: String, outPath: String) {
    let asset = loadAsset(path)
    guard let track = asset.tracks(withMediaType: .audio).first else { fail("no audio track") }
    let reader = try! AVAssetReader(asset: asset)
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
        AVSampleRateKey: 22050,
        AVNumberOfChannelsKey: 1,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    reader.add(output)
    reader.startReading()
    var all = Data()
    while let sb = output.copyNextSampleBuffer() {
        guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
        var len = 0
        var ptr: UnsafeMutablePointer<Int8>? = nil
        CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
        if let p = ptr, len > 0 {
            all.append(UnsafeBufferPointer(start: UnsafeRawPointer(p).assumingMemoryBound(to: UInt8.self), count: len))
        }
        CMSampleBufferInvalidate(sb)
    }
    try? all.write(to: URL(fileURLWithPath: outPath))
    print("wrote \(all.count) bytes to \(outPath)")
}

switch cmd {
case "info":
    guard args.count >= 3 else { fail("info <video>") }
    info(args[2])
case "frames":
    guard args.count >= 5 else { fail("frames <video> <outDir> <count> [maxWidth]") }
    let mw = args.count >= 6 ? CGFloat(Double(args[5]) ?? 1280) : 1280
    extractCount(args[2], outDir: args[3], count: Int(args[4]) ?? 12, maxWidth: mw)
case "range":
    guard args.count >= 7 else { fail("range <video> <outDir> <start> <end> <fps> [maxWidth]") }
    let mw = args.count >= 8 ? CGFloat(Double(args[7]) ?? 1280) : 1280
    extractRange(args[2], outDir: args[3], start: Double(args[4]) ?? 0, end: Double(args[5]) ?? 1, fps: Double(args[6]) ?? 8, maxWidth: mw)
case "pcm":
    guard args.count >= 4 else { fail("pcm <video> <outPath>") }
    extractPCM(args[2], outPath: args[3])
default:
    fail("unknown command \(cmd)")
}
