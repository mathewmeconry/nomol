package com.margelo.nitro.nomol

import android.util.Log
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.margelo.nitro.NitroModules
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val TAG = "NomolPose"

/** Spotters and waiting gymnasts are often in the picture too. */
private const val MAX_POSES = 4

/**
 * A pose landmarker on a bundled model (`pose_landmarker_<name>.task`). The GPU delegate is much
 * faster but may not work on every phone, failing either when created or only at the first
 * detection; either way the landmarker is created again on the CPU, once. Not thread-safe.
 */
internal class Landmarker(
  name: String,
  private val mode: RunningMode,
) {
  private val model = readAsset("pose_landmarker_$name.task")
  private var delegate = Delegate.GPU
  private var landmarker =
    try {
      createLandmarker(model, mode, Delegate.GPU)
    } catch (e: Exception) {
      Log.w(TAG, "GPU delegate failed, using CPU", e)
      delegate = Delegate.CPU
      createLandmarker(model, mode, Delegate.CPU)
    }

  fun <T> run(detect: (PoseLandmarker) -> T): T =
    try {
      detect(landmarker)
    } catch (e: Exception) {
      if (delegate != Delegate.GPU) throw e
      Log.w(TAG, "GPU delegate failed while detecting, using CPU", e)
      landmarker.close()
      delegate = Delegate.CPU
      landmarker = createLandmarker(model, mode, Delegate.CPU)
      detect(landmarker)
    }

  fun close() = landmarker.close()
}

private fun createLandmarker(
  model: ByteBuffer,
  mode: RunningMode,
  delegate: Delegate,
): PoseLandmarker {
  val options =
    PoseLandmarker.PoseLandmarkerOptions
      .builder()
      .setBaseOptions(BaseOptions.builder().setModelAssetBuffer(model).setDelegate(delegate).build())
      .setRunningMode(mode)
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

/** x, y and visibility of each landmark, all poses in one list (the specs' layout). */
internal fun flatten(landmarks: List<List<NormalizedLandmark>>): DoubleArray {
  val result = DoubleArray(landmarks.sumOf { it.size } * 3)
  var i = 0
  for (pose in landmarks) {
    for (landmark in pose) {
      result[i++] = landmark.x().toDouble()
      result[i++] = landmark.y().toDouble()
      result[i++] = landmark.visibility().orElse(1f).toDouble()
    }
  }
  return result
}
