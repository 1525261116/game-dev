// vprobe.m — macOS AVFoundation 视频探测/抽帧/取音工具（无可用 ffmpeg 环境下的替代方案）
// 编译: clang -fobjc-arc -fmodules-cache-path=./build/modulecache -o build/vprobe vprobe.m \
//         -framework Foundation -framework AVFoundation -framework CoreMedia -framework CoreGraphics -framework AppKit
// 用法:
//   vprobe info  <video>
//   vprobe range <video> <outDir> <start> <end> <fps> <maxWidth> [exact0|1]
//   vprobe pcm   <video> <outPath> [sampleRate]
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <AppKit/AppKit.h>

static void printInfo(NSString *path) {
    NSURL *url = [NSURL fileURLWithPath:path];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
    double dur = CMTimeGetSeconds(asset.duration);
    NSMutableString *out = [NSMutableString string];
    [out appendFormat:@"{\n  \"duration\": %.4f,\n  \"tracks\": [\n", dur];
    NSUInteger i = 0;
    for (AVAssetTrack *track in asset.tracks) {
        NSMutableArray *fields = [NSMutableArray array];
        [fields addObject:[NSString stringWithFormat:@"\"mediaType\": \"%@\"", track.mediaType]];
        [fields addObject:[NSString stringWithFormat:@"\"nominalFrameRate\": %.4f", track.nominalFrameRate]];
        [fields addObject:[NSString stringWithFormat:@"\"naturalSize\": {\"w\": %.1f, \"h\": %.1f}", track.naturalSize.width, track.naturalSize.height]];
        CGAffineTransform t = track.preferredTransform;
        [fields addObject:[NSString stringWithFormat:@"\"transform\": [%.3f, %.3f, %.3f, %.3f, %.1f, %.1f]", t.a, t.b, t.c, t.d, t.tx, t.ty]];
        [fields addObject:[NSString stringWithFormat:@"\"timeRange\": {\"start\": %.4f, \"duration\": %.4f}", CMTimeGetSeconds(track.timeRange.start), CMTimeGetSeconds(track.timeRange.duration)]];
        AVAssetTrack *t2 = track;
        if ([t2 respondsToSelector:@selector(estimatedDataRate)]) {
            [fields addObject:[NSString stringWithFormat:@"\"estimatedDataRate\": %.0f", t2.estimatedDataRate]];
        }
        NSMutableArray *fmts = [NSMutableArray array];
        for (id desc in track.formatDescriptions) {
            CMFormatDescriptionRef d = (__bridge CMFormatDescriptionRef)desc;
            FourCharCode sub = CMFormatDescriptionGetMediaSubType(d);
            char c[5] = { (char)((sub >> 24) & 0xFF), (char)((sub >> 16) & 0xFF), (char)((sub >> 8) & 0xFF), (char)(sub & 0xFF), 0 };
            NSMutableString *s = [NSMutableString stringWithFormat:@"\"fourcc\": \"%s\"", c];
            if (track.mediaType == AVMediaTypeVideo) {
                CMVideoDimensions dims = CMVideoFormatDescriptionGetDimensions(d);
                [s appendFormat:@", \"dims\": {\"w\": %d, \"h\": %d}", dims.width, dims.height];
                NSDictionary *ext = (__bridge NSDictionary *)CMFormatDescriptionGetExtensions(d);
                if (ext[@"BitDepth"]) [s appendFormat:@", \"bitDepth\": %@", ext[@"BitDepth"]];
                if (ext[@"FullRangeVideo"]) [s appendFormat:@", \"fullRange\": %@", ext[@"FullRangeVideo"]];
            } else {
                const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(d);
                if (asbd) {
                    [s appendFormat:@", \"sampleRate\": %.1f, \"channels\": %u, \"bitsPerChannel\": %u, \"formatFlags\": %u",
                        asbd->mSampleRate, asbd->mChannelsPerFrame, asbd->mBitsPerChannel, (unsigned)asbd->mFormatFlags];
                }
            }
            [fmts addObject:[NSString stringWithFormat:@"{ %@ }", s]];
        }
        [fields addObject:[NSString stringWithFormat:@"\"formats\": [%@]", [fmts componentsJoinedByString:@", "]]];
        [out appendFormat:@"    %@%@\n", [fields componentsJoinedByString:@", "], (i + 1 < asset.tracks.count ? @"," : @"")];
        i++;
    }
    [out appendString:@"  ]\n}"];
    printf("%s\n", out.UTF8String);
}

static BOOL saveJPEG(CGImageRef cg, NSString *path, double quality) {
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
    NSData *data = [rep representationUsingType:NSBitmapImageFileTypeJPEG
                                     properties:@{ NSImageCompressionFactor: @(quality) }];
    if (!data) return NO;
    return [data writeToFile:path atomically:YES];
}

static void extractRange(NSString *path, NSString *outDir, double start, double end, double fps, double maxWidth, BOOL exact) {
    NSURL *url = [NSURL fileURLWithPath:path];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
    AVAssetImageGenerator *gen = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
    gen.appliesPreferredTrackTransform = YES;
    if (exact) {
        gen.requestedTimeToleranceBefore = kCMTimeZero;
        gen.requestedTimeToleranceAfter = kCMTimeZero;
    } else {
        gen.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(0.02, 600);
        gen.requestedTimeToleranceAfter = CMTimeMakeWithSeconds(0.02, 600);
    }
    if (maxWidth > 0) gen.maximumSize = CGSizeMake(maxWidth, maxWidth * 4);
    [[NSFileManager defaultManager] createDirectoryAtPath:outDir withIntermediateDirectories:YES attributes:nil error:nil];
    double step = 1.0 / fps;
    NSMutableArray *manifest = [NSMutableArray array];
    int idx = 0;
    for (double t = start; t <= end + 1e-6; t += step) {
        CMTime time = CMTimeMakeWithSeconds(t, 60000);
        NSError *err = nil;
        CGImageRef cg = [gen copyCGImageAtTime:time actualTime:NULL error:&err];
        if (cg) {
            NSString *name = [NSString stringWithFormat:@"f%05d_%08.3f.jpg", idx, t];
            if (saveJPEG(cg, [outDir stringByAppendingPathComponent:name], 0.88)) {
                [manifest addObject:[NSString stringWithFormat:@"{\"file\": \"%@\", \"t\": %.3f}", name, t]];
            }
            CGImageRelease(cg);
        }
        idx++;
    }
    printf("[%s]\n", [[manifest componentsJoinedByString:@","] UTF8String]);
}

static void extractPCM(NSString *path, NSString *outPath, double sampleRate) {
    NSURL *url = [NSURL fileURLWithPath:path];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
    AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
    if (!track) { fprintf(stderr, "no audio track\n"); exit(2); }
    NSError *err = nil;
    AVAssetReader *reader = [[AVAssetReader alloc] initWithAsset:asset error:&err];
    NSDictionary *settings = @{
        AVFormatIDKey: @(kAudioFormatLinearPCM),
        AVLinearPCMBitDepthKey: @32,
        AVLinearPCMIsFloatKey: @YES,
        AVLinearPCMIsBigEndianKey: @NO,
        AVLinearPCMIsNonInterleaved: @NO,
        AVSampleRateKey: @(sampleRate),
        AVNumberOfChannelsKey: @1,
    };
    AVAssetReaderTrackOutput *output = [[AVAssetReaderTrackOutput alloc] initWithTrack:track outputSettings:settings];
    output.alwaysCopiesSampleData = NO;
    [reader addOutput:output];
    [reader startReading];
    NSMutableData *all = [NSMutableData data];
    while (reader.status == AVAssetReaderStatusReading) {
        CMSampleBufferRef sb = [output copyNextSampleBuffer];
        if (!sb) break;
        CMBlockBufferRef bb = CMSampleBufferGetDataBuffer(sb);
        if (bb) {
            size_t len = CMBlockBufferGetDataLength(bb);
            char *tmp = malloc(len);
            CMBlockBufferCopyDataBytes(bb, 0, len, tmp);
            [all appendBytes:tmp length:len];
            free(tmp);
        }
        CFRelease(sb);
    }
    [all writeToFile:outPath atomically:YES];
    printf("wrote %lu bytes @ %.0fHz mono float32 to %s\n", (unsigned long)all.length, sampleRate, outPath.UTF8String);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) { fprintf(stderr, "usage: vprobe <info|range|pcm> ...\n"); return 1; }
        NSString *cmd = [NSString stringWithUTF8String:argv[1]];
        NSString *path = [NSString stringWithUTF8String:argv[2]];
        if ([cmd isEqualToString:@"info"]) {
            printInfo(path);
        } else if ([cmd isEqualToString:@"range"]) {
            if (argc < 8) { fprintf(stderr, "range <video> <outDir> <start> <end> <fps> <maxWidth> [exact]\n"); return 1; }
            extractRange(path, [NSString stringWithUTF8String:argv[3]], atof(argv[4]), atof(argv[5]), atof(argv[6]), atof(argv[7]), argc >= 9 ? atoi(argv[8]) != 0 : NO);
        } else if ([cmd isEqualToString:@"pcm"]) {
            if (argc < 4) { fprintf(stderr, "pcm <video> <outPath> [sampleRate]\n"); return 1; }
            extractPCM(path, [NSString stringWithUTF8String:argv[3]], argc >= 5 ? atof(argv[4]) : 22050.0);
        } else {
            fprintf(stderr, "unknown command\n");
            return 1;
        }
    }
    return 0;
}
