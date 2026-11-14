package com.margelo.nitro.nomol

import android.os.SystemClock

/**
 * Camera frames carry sensor timestamps; on phones with a realtime timestamp source (e.g. the
 * Pixel 8) they count from boot including deep sleep, as `elapsedRealtimeNanos` does. JS checks
 * the result against frame times and falls back where a phone uses another clock.
 */
class HybridCameraClock : HybridCameraClockSpec() {
  override fun now(): Double = SystemClock.elapsedRealtimeNanos() / 1e6
}
