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

/** A pose landmarker on a bundled model (`pose_landmarker_<name>.task`). */
internal fun createLandmarker(
  name: String,
  mode: RunningMode,
): PoseLandmarker {
  val buffer = readAsset("pose_landmarker_$name.task")
  // The GPU delegate is much faster but may not start on every phone.
  return try {
    createLandmarker(buffer, mode, Delegate.GPU)
  } catch (e: Exception) {
    Log.w(TAG, "GPU delegate failed, using CPU", e)
    createLandmarker(buffer, mode, Delegate.CPU)
  }
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
