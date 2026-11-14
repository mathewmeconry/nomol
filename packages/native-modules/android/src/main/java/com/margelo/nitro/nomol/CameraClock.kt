package com.margelo.nitro.nomol

import android.os.SystemClock
import android.util.Log
import kotlin.math.abs

/**
 * The two clocks camera timestamps come in. Frames for analysis carry the sensor's clock (on
 * most phones BOOTTIME, else MONOTONIC), while a surface feeding a video encoder gets MONOTONIC
 * under Camera2's default timestamp base. They differ by the time the phone spent asleep since
 * boot, often hours, so both are converted to BOOTTIME before they are compared.
 */
enum class Clock { BOOTTIME, MONOTONIC }

/**
 * Which clock a camera timestamp taken just now is in: the one whose current time is closer, as
 * CameraX's video recorder decides it. A wrong choice is only possible when the clocks are
 * closer than the camera's latency, and then it costs no more than that.
 */
fun clockOf(
  timestampNs: Long,
  monotonicNowNs: Long,
  boottimeNowNs: Long,
): Clock = if (abs(boottimeNowNs - timestampNs) <= abs(monotonicNowNs - timestampNs)) Clock.BOOTTIME else Clock.MONOTONIC

/** [timestampNs] in [clock] as BOOTTIME; [offsetNs] is BOOTTIME minus MONOTONIC now. */
fun toBoottime(
  timestampNs: Long,
  clock: Clock,
  offsetNs: Long,
): Long = if (clock == Clock.MONOTONIC) timestampNs + offsetNs else timestampNs

/** [toBoottime] reversed. */
fun fromBoottime(
  timestampNs: Long,
  clock: Clock,
  offsetNs: Long,
): Long = if (clock == Clock.MONOTONIC) timestampNs - offsetNs else timestampNs

/** The clocks of this phone's camera, as found on the first frame and the first encoded sample. */
internal object CameraClock {
  private const val TAG = "NomolRecorder"

  /** The clock of frame timestamps (detection, JS), once a frame was detected. */
  @Volatile var frames: Clock? = null
    private set

  /** BOOTTIME minus MONOTONIC; changes only while the phone sleeps, never with the camera on. */
  fun offsetNs() = SystemClock.elapsedRealtimeNanos() - System.nanoTime()

  /** Which clock a timestamp taken just now by the camera is in; logs both clocks once per [what]. */
  fun detect(
    timestampNs: Long,
    what: String,
  ): Clock {
    val monotonic = System.nanoTime()
    val boottime = SystemClock.elapsedRealtimeNanos()
    val clock = clockOf(timestampNs, monotonic, boottime)
    Log.d(TAG, "$what timestamp $timestampNs, monotonic $monotonic, boottime $boottime: $clock")
    return clock
  }

  /** Called with each detected frame's timestamp; only the first one is looked at. */
  fun sawFrame(timestampNs: Long) {
    if (frames == null) frames = detect(timestampNs, "Frame")
  }
}
