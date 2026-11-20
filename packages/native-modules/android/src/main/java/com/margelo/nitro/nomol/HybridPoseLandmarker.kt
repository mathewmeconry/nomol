package com.margelo.nitro.nomol

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * MediaPipe Pose Landmarker on VisionCamera frames. It has no region of interest for poses, so
 * the crops (where to look, `detectionAreas` in core) are cut out here, turned upright and
 * shrunk; all coordinate math stays in core.
 */
@Keep
@DoNotStrip
class HybridPoseLandmarker : HybridPoseLandmarkerSpec() {
  /** Detection runs on the camera thread, a model switch on a background one. */
  private val lock = Any()
  private var modelName: String? = null

  /**
   * One per crop (the first crop always goes to the first): in VIDEO mode MediaPipe follows the
   * poses it found into the next picture, and alternating two start zones on one landmarker lost
   * that. Its person detector alone misses many people with their arms above the head: on the
   * floor (November 20 2026) a girl showing the start sign was found in 5 of 60 frames that way,
   * followed in 43 with a landmarker of her own.
   */
  private val landmarkers = mutableListOf<Landmarker>()
  private val lastTimesMs = mutableListOf<Long>()
  private var count = 0

  /** One at a time, so a slow write never piles up work on the camera thread. */
  private val stillWriter = Executors.newSingleThreadExecutor()

  override fun load(model: Model): Promise<Unit> =
    Promise.async {
      val name = if (model == Model.HEAVY) "heavy" else "lite"
      val created = Landmarker(name, RunningMode.VIDEO)
      synchronized(lock) {
        landmarkers.forEach { it.close() }
        landmarkers.clear()
        lastTimesMs.clear()
        landmarkers.add(created)
        lastTimesMs.add(Long.MIN_VALUE)
        modelName = name
      }
    }

  override fun detect(
    frame: HybridFrameSpec,
    crops: Array<Crop>,
    rotation: Double,
    mirrored: Boolean,
    timeMs: Double,
    stillPath: String?,
  ): Detection {
    val start = System.nanoTime()
    CameraClock.sawFrame((timeMs * 1e6).toLong())
    val image = (frame as NativeFrame).image
    val whole = image.toBitmap()
    if (stillPath != null) saveStill(whole, rotation, stillPath)
    val found = crops.mapIndexed { i, crop -> detectIn(i, whole, crop, rotation, mirrored, timeMs) }
    whole.recycle()

    val result = flatten(found.flatten())
    val ms = (System.nanoTime() - start) / 1e6 / max(crops.size, 1)
    if (++count % LOG_EVERY == 0) {
      Log.d(TAG, "${image.width}x${image.height} ${crops.size} crops turned $rotation: ${"%.1f".format(ms)} ms each, ${found.sumOf { it.size }} poses")
    }
    return Detection(result, found.map { it.size.toDouble() }.toDoubleArray(), ms)
  }

  private fun detectIn(
    index: Int,
    whole: Bitmap,
    crop: Crop,
    rotation: Double,
    mirrored: Boolean,
    timeMs: Double,
  ): List<List<NormalizedLandmark>> {
    // MediaPipe shrinks its input to 256 px anyway; a smaller bitmap is cheaper to hand over.
    val scale = min(1f, MAX_SIDE / max(crop.width, crop.height).toFloat())
    val matrix =
      Matrix().apply {
        postRotate(rotation.toFloat())
        postScale(if (mirrored) -scale else scale, scale)
      }
    val input =
      Bitmap.createBitmap(
        whole,
        crop.x.toInt(),
        crop.y.toInt(),
        crop.width.toInt(),
        crop.height.toInt(),
        matrix,
        true,
      )
    try {
      return synchronized(lock) {
        val name = modelName ?: return emptyList()
        // Created on the camera thread the first time a second start zone is looked at: that
        // frame is late, but nobody pays for a landmarker never used.
        while (landmarkers.size <= index) {
          landmarkers.add(Landmarker(name, RunningMode.VIDEO))
          lastTimesMs.add(Long.MIN_VALUE)
        }
        // MediaPipe refuses timestamps that don't grow.
        val time = max(timeMs.toLong(), lastTimesMs[index] + 1)
        lastTimesMs[index] = time
        landmarkers[index].run { it.detectForVideo(BitmapImageBuilder(input).build(), time) }.landmarks()
      }
    } finally {
      // createBitmap may hand back the frame's own bitmap, recycled after all crops.
      if (input !== whole) input.recycle()
    }
  }

  /**
   * Shrinks and turns on the camera thread (cheap); compresses in the background. Never mirrored,
   * like the video, which the replay skeleton is drawn over.
   */
  private fun saveStill(
    whole: Bitmap,
    rotation: Double,
    path: String,
  ) {
    val scale = min(1f, STILL_SIDE / max(whole.width, whole.height).toFloat())
    val matrix =
      Matrix().apply {
        postRotate(rotation.toFloat())
        postScale(scale, scale)
      }
    var still = Bitmap.createBitmap(whole, 0, 0, whole.width, whole.height, matrix, true)
    // createBitmap may hand back the frame's own bitmap, which is recycled right after detection.
    if (still === whole) still = whole.copy(Bitmap.Config.ARGB_8888, false)
    stillWriter.execute {
      try {
        val file = File(path)
        file.parentFile?.mkdirs()
        FileOutputStream(file).use { still.compress(Bitmap.CompressFormat.JPEG, STILL_QUALITY, it) }
      } catch (e: Exception) {
        Log.w(TAG, "Could not save still $path", e)
      } finally {
        still.recycle()
      }
    }
  }

  override fun dispose() {
    super.dispose()
    stillWriter.shutdown()
    synchronized(lock) {
      landmarkers.forEach { it.close() }
      landmarkers.clear()
      modelName = null
    }
  }

  companion object {
    private const val TAG = "NomolPose"

    private const val MAX_SIDE = 512f

    /** Like the web app's skeleton frames: enough for MediaPipe on a crop around the gymnast. */
    private const val STILL_SIDE = 640f
    private const val STILL_QUALITY = 85

    /** Timing in logcat now and then, to check the phone's speed. */
    private const val LOG_EVERY = 100
  }
}
