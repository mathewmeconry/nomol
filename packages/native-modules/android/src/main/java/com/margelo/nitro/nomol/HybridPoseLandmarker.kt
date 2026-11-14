package com.margelo.nitro.nomol

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import com.margelo.nitro.core.Promise
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/**
 * MediaPipe Pose Landmarker on VisionCamera frames. It has no region of interest for poses, so
 * the crop (where to look, `detectionArea` in core) is cut out here, turned upright and shrunk;
 * all coordinate math stays in core.
 */
class HybridPoseLandmarker : HybridPoseLandmarkerSpec() {
  /** Detection runs on the camera thread, a model switch on a background one. */
  private val lock = Any()
  private var landmarker: PoseLandmarker? = null
  private var lastTimeMs = Long.MIN_VALUE
  private var count = 0

  /** One at a time, so a slow write never piles up work on the camera thread. */
  private val stillWriter = Executors.newSingleThreadExecutor()

  override fun load(model: Model): Promise<Unit> =
    Promise.async {
      val name = if (model == Model.HEAVY) "heavy" else "lite"
      val buffer = readAsset("pose_landmarker_$name.task")
      // The GPU delegate is much faster but may not start on every phone.
      val created =
        try {
          create(buffer, Delegate.GPU)
        } catch (e: Exception) {
          Log.w(TAG, "GPU delegate failed, using CPU", e)
          create(buffer, Delegate.CPU)
        }
      synchronized(lock) {
        landmarker?.close()
        landmarker = created
      }
    }

  override fun detect(
    frame: HybridFrameSpec,
    crop: Crop,
    rotation: Double,
    mirrored: Boolean,
    timeMs: Double,
    stillPath: String?,
  ): Detection {
    val start = System.nanoTime()
    val image = (frame as NativeFrame).image
    val whole = image.toBitmap()
    if (stillPath != null) saveStill(whole, rotation, mirrored, stillPath)
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
    whole.recycle()

    val landmarks =
      synchronized(lock) {
        val landmarker = landmarker ?: return Detection(DoubleArray(0), 0.0)
        // MediaPipe refuses timestamps that don't grow.
        val time = max(timeMs.toLong(), lastTimeMs + 1)
        lastTimeMs = time
        landmarker.detectForVideo(BitmapImageBuilder(input).build(), time).landmarks()
      }
    input.recycle()

    val result = DoubleArray(landmarks.sumOf { it.size } * 3)
    var i = 0
    for (pose in landmarks) {
      for (landmark in pose) {
        result[i++] = landmark.x().toDouble()
        result[i++] = landmark.y().toDouble()
        result[i++] = landmark.visibility().orElse(1f).toDouble()
      }
    }
    val ms = (System.nanoTime() - start) / 1e6
    if (++count % LOG_EVERY == 0) {
      Log.d(TAG, "${image.width}x${image.height} crop ${crop.width.toInt()}x${crop.height.toInt()} turned $rotation: ${"%.1f".format(ms)} ms, ${landmarks.size} poses")
    }
    return Detection(result, ms)
  }

  /** Shrinks and turns on the camera thread (cheap); compresses in the background. */
  private fun saveStill(
    whole: Bitmap,
    rotation: Double,
    mirrored: Boolean,
    path: String,
  ) {
    val scale = min(1f, STILL_SIDE / max(whole.width, whole.height).toFloat())
    val matrix =
      Matrix().apply {
        postRotate(rotation.toFloat())
        postScale(if (mirrored) -scale else scale, scale)
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
      landmarker?.close()
      landmarker = null
    }
  }

  private fun create(
    model: ByteBuffer,
    delegate: Delegate,
  ): PoseLandmarker {
    val options =
      PoseLandmarker.PoseLandmarkerOptions
        .builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(model).setDelegate(delegate).build())
        .setRunningMode(RunningMode.VIDEO)
        .setNumPoses(MAX_POSES)
        .build()
    return PoseLandmarker.createFromOptions(context(), options)
  }

  /** Read into memory: MediaPipe can't open compressed assets by path. */
  private fun readAsset(name: String): ByteBuffer {
    val bytes = context().assets.open(name).use { it.readBytes() }
    return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).put(bytes).apply { rewind() }
  }

  private fun context() = NitroModules.applicationContext ?: throw Error("No application context")

  companion object {
    private const val TAG = "NomolPose"

    /** Spotters and waiting gymnasts are often in the picture too. */
    private const val MAX_POSES = 4

    private const val MAX_SIDE = 512f

    /** Like the web app's skeleton frames: enough for MediaPipe on a crop around the gymnast. */
    private const val STILL_SIDE = 640f
    private const val STILL_QUALITY = 85

    /** Timing in logcat now and then, to check the phone's speed. */
    private const val LOG_EVERY = 100
  }
}
