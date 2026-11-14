package com.margelo.nitro.nomol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SampleBufferTest {
  /** 30 frames per second from 0 to [untilMs], a keyframe every 0.5 s. */
  private fun filled(
    keepMs: Long,
    untilMs: Long,
  ): SampleBuffer {
    val buffer = SampleBuffer(keepMs * 1000)
    var frame = 0
    while (frame * 1000L / 30 <= untilMs) {
      buffer.add(sample(frame * 1000L / 30, key = frame % 15 == 0))
      frame++
    }
    return buffer
  }

  private fun sample(
    ms: Long,
    key: Boolean,
  ) = EncodedSample(ByteArray(1), ms * 1000, key)

  private fun List<EncodedSample>.firstMs() = first().timeUs / 1000

  @Test
  fun startsAtAKeyframe() {
    val buffer = SampleBuffer(3_000_000)
    buffer.add(sample(0, key = false))
    buffer.add(sample(33, key = false))
    assertTrue(buffer.isEmpty)
    buffer.add(sample(66, key = true))
    assertEquals(66, buffer.takeFrom(0).firstMs())
  }

  @Test
  fun keepsAtLeastTheWantedTime() {
    // At 10 s the latest keyframe 3 s back or earlier is the one at 7 s.
    val taken = filled(keepMs = 3000, untilMs = 10_000).takeFrom(0)
    assertEquals(7000, taken.firstMs())
    assertTrue(taken.first().key)
    assertEquals(10_000, taken.last().timeUs / 1000)
  }

  @Test
  fun takesFromTheLastKeyframeBeforeTheWantedTime() {
    // Trigger at 10 s, lead-in from 8.5 s back: keyframes at 8 and 8.5 s qualify, 8.5 s wins.
    assertEquals(8500, filled(3000, 10_000).takeFrom(8_500_000).firstMs())
    assertEquals(8000, filled(3000, 10_000).takeFrom(8_400_000).firstMs())
  }

  @Test
  fun takesTheFirstKeyframeWhenNoneIsEarlyEnough() {
    assertEquals(0, filled(3000, 1000).takeFrom(-500_000).firstMs())
  }

  @Test
  fun isEmptyAfterTaking() {
    val buffer = filled(3000, 5000)
    buffer.takeFrom(0)
    assertTrue(buffer.isEmpty)
    assertTrue(buffer.takeFrom(0).isEmpty())
  }
}
