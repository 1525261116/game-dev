#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
int main(int argc, char** argv) {
  @autoreleasepool {
    NSURL* u = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    AVURLAsset* a = [AVURLAsset URLAssetWithURL:u options:nil];
    printf("dur=%.3f tracks=%lu\n", CMTimeGetSeconds(a.duration), (unsigned long)a.tracks.count);
    for (AVAssetTrack* t in a.tracks) {
      printf("track %s fps=%.3f size=%.0fx%.0f\n", t.mediaType.UTF8String, t.nominalFrameRate, t.naturalSize.width, t.naturalSize.height);
    }
  }
  return 0;
}
