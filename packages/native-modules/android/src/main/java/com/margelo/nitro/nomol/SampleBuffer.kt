package com.margelo.nitro.nomol

/** One encoded video frame. */
class EncodedSample(
  val data: ByteArray,
  val timeUs: Long,
  val key: Boolean,
)

/**
 * The last [keepUs] of encoded video, always starting at a keyframe, since a video can only
 * begin at one. Not thread-safe: used on the encoder's thread only.
 */
class SampleBuffer(
  private val keepUs: Long,
) {
  private val samples = ArrayDeque<EncodedSample>()

  val isEmpty: Boolean
    get() = samples.isEmpty()

  /** Adds a sample, then drops what is older than the latest keyframe at least [keepUs] back. */
  fun add(sample: EncodedSample) {
    if (samples.isEmpty() && !sample.key) return
    samples.addLast(sample)
    val keepFrom = samples.lastOrNull { it.key && it.timeUs <= sample.timeUs - keepUs } ?: return
    while (samples.first() !== keepFrom) samples.removeFirst()
  }

  /**
   * Removes and returns the samples from the latest keyframe at or before [fromUs] (the first
   * keyframe if none is that early) to the newest; the buffer is empty afterwards.
   */
  fun takeFrom(fromUs: Long): List<EncodedSample> {
    val start = samples.lastOrNull { it.key && it.timeUs <= fromUs } ?: samples.firstOrNull()
    val taken = if (start == null) emptyList() else samples.toList().dropWhile { it !== start }
    samples.clear()
    return taken
  }

  fun clear() = samples.clear()
}
