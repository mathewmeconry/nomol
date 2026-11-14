package com.margelo.nitro.nomol

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.margelo.nitro.core.Promise

/**
 * MediaPipe heavy in IMAGE mode on saved stills, for the replay skeleton: cuts a turned square out
 * of a still, like the web app's skeleton worker draws it on a canvas. Runs on Nitro's background
 * threads; which views to try is decided in core.
 */
class HybridSkeletonLandmarker : HybridSkeletonLandmarkerSpec() {
  /** Calls come one after the other from JS, but on whichever background thread is free. */
  private val lock = Any()
  private var landmarker: Landmarker? = null
  private var still: Bitmap? = null
  private val view = Bitmap.createBitmap(VIEW_SIZE, VIEW_SIZE, Bitmap.Config.ARGB_8888)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)

  override fun load(): Promise<Unit> =
    Promise.async {
      val created = Landmarker("heavy", RunningMode.IMAGE)
      synchronized(lock) {
        landmarker?.close()
        landmarker = created
      }
    }

  override fun open(path: String): Promise<StillSize> =
    Promise.async {
      val decoded = BitmapFactory.decodeFile(path) ?: throw Error("Could not read $path")
      synchronized(lock) {
        still?.recycle()
        still = decoded
      }
      StillSize(decoded.width.toDouble(), decoded.height.toDouble())
    }

  override fun detect(
    centerX: Double,
    centerY: Double,
    size: Double,
    angle: Double,
  ): Promise<DoubleArray> =
    Promise.async {
      synchronized(lock) {
        val landmarker = landmarker ?: throw Error("Model not loaded")
        val still = still ?: throw Error("No still open")
        val scale = (VIEW_SIZE / size).toFloat()
        // Same transform as the web worker's canvas: the still turned by -angle around the
        // view's centre, scaled so the view fills VIEW_SIZE; black outside the still.
        val matrix =
          Matrix().apply {
            postTranslate(-centerX.toFloat(), -centerY.toFloat())
            postRotate(Math.toDegrees(-angle).toFloat())
            postScale(scale, scale)
            postTranslate(VIEW_SIZE / 2f, VIEW_SIZE / 2f)
          }
        val canvas = Canvas(view)
        canvas.drawColor(Color.BLACK)
        canvas.drawBitmap(still, matrix, paint)
        flatten(landmarker.run { it.detect(BitmapImageBuilder(view).build()) }.landmarks())
      }
    }

  override fun dispose() {
    super.dispose()
    synchronized(lock) {
      landmarker?.close()
      landmarker = null
      still?.recycle()
      still = null
    }
  }

  companion object {
    /** Side of the turned view handed to MediaPipe, as in the web app. */
    private const val VIEW_SIZE = 512
  }
}
