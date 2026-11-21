package com.margelo.nitro.nomol

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import java.nio.FloatBuffer

/**
 * RTMPose-m (body7, 256×192) on ONNX Runtime: the pose of the person a view is centred on, with
 * no person detector. The view's square is cut to the model's 3:4 (its full height, the middle
 * three quarters of its width): on the hand-labelled test frames a crop about the size of the
 * replay skeleton's views hit 92 % of the points, 0.6 of it 78 %. Preprocessing and decoding as
 * rtmlib's, which those numbers were measured with. Not thread-safe.
 */
internal class RtmPose {
  private val environment = OrtEnvironment.getEnvironment()
  private val session =
    environment.createSession(
      readAssetBytes("rtmpose_m.onnx"),
      OrtSession.SessionOptions().apply { setIntraOpNumThreads(THREADS) },
    )
  private val inputName = session.inputNames.first()
  private val input = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val pixels = IntArray(WIDTH * HEIGHT)
  private val tensor = FloatBuffer.allocate(3 * WIDTH * HEIGHT)

  /**
   * The 33 MediaPipe landmarks (the specs' layout) normalized to the view: COCO's 17 where they
   * match, the rest with visibility 0.
   */
  fun detect(
    still: Bitmap,
    centerX: Double,
    centerY: Double,
    size: Double,
    angle: Double,
  ): DoubleArray {
    // HEIGHT pixels for the view's side, so a pixel of the input is 1/HEIGHT of the view.
    val scale = (HEIGHT / size).toFloat()
    val matrix =
      Matrix().apply {
        postTranslate(-centerX.toFloat(), -centerY.toFloat())
        postRotate(Math.toDegrees(-angle).toFloat())
        postScale(scale, scale)
        postTranslate(WIDTH / 2f, HEIGHT / 2f)
      }
    val canvas = Canvas(input)
    canvas.drawColor(Color.BLACK)
    canvas.drawBitmap(still, matrix, paint)
    input.getPixels(pixels, 0, WIDTH, 0, 0, WIDTH, HEIGHT)
    // rtmlib hands the model OpenCV's BGR order with these means and deviations.
    val plane = WIDTH * HEIGHT
    for (i in 0 until plane) {
      val pixel = pixels[i]
      tensor.put(i, ((pixel and 0xff) - 123.675f) / 58.395f)
      tensor.put(plane + i, (((pixel shr 8) and 0xff) - 116.28f) / 57.12f)
      tensor.put(2 * plane + i, (((pixel shr 16) and 0xff) - 103.53f) / 57.375f)
    }
    val shape = longArrayOf(1, 3, HEIGHT.toLong(), WIDTH.toLong())
    OnnxTensor.createTensor(environment, tensor, shape).use { input ->
      session.run(mapOf(inputName to input)).use { output ->
        @Suppress("UNCHECKED_CAST")
        val x = (output[0].value as Array<Array<FloatArray>>)[0]

        @Suppress("UNCHECKED_CAST")
        val y = (output[1].value as Array<Array<FloatArray>>)[0]
        val result = DoubleArray(33 * 3) { if (it % 3 == 2) 0.0 else 0.5 }
        for (k in 0 until 17) {
          val (xAt, xMax) = argmax(x[k])
          val (yAt, yMax) = argmax(y[k])
          val landmark = COCO_TO_MEDIAPIPE[k] * 3
          result[landmark] = 0.5 + (xAt / SPLIT - WIDTH / 2.0) / HEIGHT
          result[landmark + 1] = 0.5 + (yAt / SPLIT - HEIGHT / 2.0) / HEIGHT
          result[landmark + 2] = ((xMax + yMax) / 2.0).coerceIn(0.0, 1.0)
        }
        return result
      }
    }
  }

  fun close() {
    session.close()
    input.recycle()
  }

  private fun argmax(values: FloatArray): Pair<Int, Float> {
    var best = 0
    for (i in values.indices) if (values[i] > values[best]) best = i
    return best to values[best]
  }

  companion object {
    private const val WIDTH = 192
    private const val HEIGHT = 256

    /** SimCC bins per input pixel. */
    private const val SPLIT = 2.0
    private const val THREADS = 4

    /** COCO's keypoints as MediaPipe's landmarks (core's `MP_TO_COCO` the other way). */
    private val COCO_TO_MEDIAPIPE = intArrayOf(0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
  }
}
