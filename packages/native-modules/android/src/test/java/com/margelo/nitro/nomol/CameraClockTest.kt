package com.margelo.nitro.nomol

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraClockTest {
  /** A phone up for 10 h, asleep for 4 of them. */
  private val monotonicNow = 6 * HOUR
  private val boottimeNow = 10 * HOUR
  private val offset = boottimeNow - monotonicNow

  @Test
  fun `a timestamp shortly before now is in the clock it is closest to`() {
    assertEquals(Clock.BOOTTIME, clockOf(boottimeNow - 40 * MS, monotonicNow, boottimeNow))
    assertEquals(Clock.MONOTONIC, clockOf(monotonicNow - 40 * MS, monotonicNow, boottimeNow))
  }

  @Test
  fun `clocks closer than the latency make either choice almost right`() {
    // Never slept: both clocks agree to a millisecond.
    val clock = clockOf(5 * HOUR - 30 * MS, 5 * HOUR, 5 * HOUR + MS)
    val converted = toBoottime(5 * HOUR - 30 * MS, clock, MS)
    assertEquals((5 * HOUR - 30 * MS).toDouble(), converted.toDouble(), MS.toDouble())
  }

  @Test
  fun `monotonic timestamps move to boottime and back`() {
    val encoded = monotonicNow - 40 * MS
    val captured = boottimeNow - 40 * MS
    assertEquals(captured, toBoottime(encoded, Clock.MONOTONIC, offset))
    assertEquals(encoded, fromBoottime(captured, Clock.MONOTONIC, offset))
  }

  @Test
  fun `boottime timestamps stay as they are`() {
    assertEquals(boottimeNow, toBoottime(boottimeNow, Clock.BOOTTIME, offset))
    assertEquals(boottimeNow, fromBoottime(boottimeNow, Clock.BOOTTIME, offset))
  }

  @Test
  fun `an encoder on monotonic and frames on boottime meet on one clock`() {
    // The same capture, as an analysis frame and as an encoded sample.
    val frame = boottimeNow - 40 * MS
    val sample = monotonicNow - 40 * MS
    val frameClock = clockOf(frame, monotonicNow, boottimeNow)
    val sampleClock = clockOf(sample, monotonicNow, boottimeNow)
    assertEquals(toBoottime(frame, frameClock, offset), toBoottime(sample, sampleClock, offset))
  }

  private companion object {
    const val MS = 1_000_000L
    const val HOUR = 3_600_000 * MS
  }
}
