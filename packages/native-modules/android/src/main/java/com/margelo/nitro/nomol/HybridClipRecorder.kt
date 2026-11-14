package com.margelo.nitro.nomol

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import com.margelo.nitro.camera.CameraOrientation
import com.margelo.nitro.camera.HybridCameraOutputSpec
import com.margelo.nitro.camera.MediaType
import com.margelo.nitro.camera.MirrorMode
import com.margelo.nitro.camera.extensions.converters.toSize
import com.margelo.nitro.camera.extensions.surfaceRotation
import com.margelo.nitro.camera.public.NativeCameraOutput
import com.margelo.nitro.core.Promise
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executor

/** 4:3 like the preview and the detected frames, Full HD class. */
private val VIDEO_SIZE = Size(1440, 1080)

/** About what CameraX's recorder chose for this size. */
private const val BIT_RATE = 12_000_000

/**
 * Phones otherwise write a keyframe every 1–3 s, and scrubbing the replay looks frozen while
 * each seek decodes that much video (the web app does the same).
 */
private const val KEYFRAME_US = 500_000L

/** Long enough for the automatic start's lead-in of 1.5–3 s (`PREROLL_MAX_MS` in core). */
private const val BUFFER_US = 3_000_000L

/**
 * Records clips with its own H.264 encoder. CameraX allows a single video recording at a time
 * and its recorder can't begin before it is started, so a second Preview use case feeds
 * MediaCodec's input surface instead. Encoder output carries the camera's frame timestamps,
 * the clock detection uses, so a video's time 0 is exactly its first frame's capture time.
 */
class HybridClipRecorder : HybridClipRecorderSpec() {
  private val thread = HandlerThread("ClipRecorder").apply { start() }
  private val handler = Handler(thread.looper)
  private val executor = Executor { handler.post(it) }

  /** One video being written. Its muxer opens at the first keyframe. */
  private class Clip(
    val path: String,
    val started: Promise<Double>,
  ) {
    var muxer: MediaMuxer? = null
    var track = -1
    var lastUs = 0L
  }

  /** The encoder of the surface the camera currently delivers to. */
  private class Encoder(
    val codec: MediaCodec,
  ) {
    var format: MediaFormat? = null
    var running = true
    var lastKeyUs = Long.MIN_VALUE
    var syncRequested = false
  }

  // Everything below is used on `thread` only.
  private val buffer = SampleBuffer(BUFFER_US)
  private var encoder: Encoder? = null
  private var clip: Clip? = null
  private var wantBuffer = false

  /** Clockwise degrees to turn the video upright, from CameraX. */
  @Volatile private var rotation = 0

  /** The camera output: a Preview use case whose surface is the encoder's input. */
  private inner class Output :
    HybridCameraOutputSpec(),
    NativeCameraOutput {
    private var preview: Preview? = null

    override val mediaType: MediaType = MediaType.VIDEO
    override var outputOrientation: CameraOrientation = CameraOrientation.UP
      set(value) {
        field = value
        preview?.targetRotation = value.surfaceRotation
      }
    override val currentResolution: com.margelo.nitro.camera.Size?
      get() = preview?.resolutionInfo?.resolution?.toSize()

    // Mirroring a Preview only changes how it is displayed; the video is never mirrored.
    override var mirrorMode: MirrorMode = MirrorMode.AUTO
      private set

    override fun createUseCase(
      mirrorMode: MirrorMode,
      config: NativeCameraOutput.Config,
    ): NativeCameraOutput.PreparedUseCase {
      val preview =
        Preview
          .Builder()
          .setResolutionSelector(
            ResolutionSelector
              .Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
              .setResolutionStrategy(
                ResolutionStrategy(VIDEO_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
              ).build(),
          ).setTargetRotation(outputOrientation.surfaceRotation)
          .build()
      // Only the use case that gets bound is asked for a surface.
      preview.setSurfaceProvider(executor, ::provideSurface)
      return NativeCameraOutput.PreparedUseCase(preview) {
        this.preview = preview
        this.mirrorMode = mirrorMode
      }
    }
  }

  override val output: HybridCameraOutputSpec = Output()

  override fun setBuffering(on: Boolean) {
    handler.post {
      wantBuffer = on
      updateRunning()
    }
  }

  override fun start(
    path: String,
    fromMs: Double,
  ): Promise<Double> {
    val started = Promise<Double>()
    handler.post {
      if (clip != null) {
        started.reject(Error("Es läuft schon eine Aufnahme."))
        return@post
      }
      File(path).parentFile?.mkdirs()
      clip = Clip(path, started)
      updateRunning()
      for (sample in buffer.takeFrom((fromMs * 1000).toLong())) write(sample)
    }
    return started
  }

  override fun stop(): Promise<Double> {
    val stopped = Promise<Double>()
    handler.post {
      try {
        val ended = finishClip()
        if (ended != null) stopped.resolve(ended) else stopped.reject(Error("Das Video ist leer."))
      } catch (e: Exception) {
        stopped.reject(e)
      }
      updateRunning()
    }
    return stopped
  }

  override fun dispose() {
    super.dispose()
    handler.post {
      runCatching { finishClip() }
      thread.quitSafely()
    }
  }

  private fun provideSurface(request: SurfaceRequest) {
    val size = request.resolution
    val format =
      MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, size.width, size.height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
        setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
          setFloat(MediaFormat.KEY_I_FRAME_INTERVAL, KEYFRAME_US / 1e6f)
        } else {
          setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
      }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    val encoder = Encoder(codec)
    // Callbacks run on `thread`, like everything else here.
    codec.setCallback(Callback(encoder), handler)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val surface = codec.createInputSurface()
    codec.start()
    this.encoder = encoder
    updateRunning()

    request.setTransformationInfoListener(executor) { rotation = it.rotationDegrees }
    request.provideSurface(surface, executor) {
      // The camera no longer delivers here (session closed or reconfigured). A clip being
      // written keeps what it has; `stop` finishes it.
      if (this.encoder === encoder) {
        this.encoder = null
        buffer.clear()
      }
      codec.stop()
      codec.release()
      surface.release()
    }
  }

  private inner class Callback(
    private val owner: Encoder,
  ) : MediaCodec.Callback() {
    override fun onInputBufferAvailable(
      codec: MediaCodec,
      index: Int,
    ) {
      // Input comes through the surface.
    }

    override fun onOutputFormatChanged(
      codec: MediaCodec,
      format: MediaFormat,
    ) {
      owner.format = format
    }

    override fun onOutputBufferAvailable(
      codec: MediaCodec,
      index: Int,
      info: MediaCodec.BufferInfo,
    ) {
      val data = codec.getOutputBuffer(index)
      val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
      if (data == null || config || info.size == 0 || owner !== encoder) {
        codec.releaseOutputBuffer(index, false)
        return
      }
      val bytes = ByteArray(info.size)
      data.position(info.offset)
      data.get(bytes)
      codec.releaseOutputBuffer(index, false)
      val sample =
        EncodedSample(bytes, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0)
      keepKeyframesClose(owner, sample)
      if (clip != null) {
        write(sample)
      } else if (wantBuffer) {
        buffer.add(sample)
      }
    }

    override fun onError(
      codec: MediaCodec,
      e: MediaCodec.CodecException,
    ) {
      // No more samples come; a clip being written keeps what it has and `stop` finishes it.
    }
  }

  /** Encoders count the keyframe interval in frames; the camera's frame rate varies (dark: ~14). */
  private fun keepKeyframesClose(
    encoder: Encoder,
    sample: EncodedSample,
  ) {
    if (sample.key) {
      encoder.lastKeyUs = sample.timeUs
      encoder.syncRequested = false
    } else if (!encoder.syncRequested && sample.timeUs - encoder.lastKeyUs >= KEYFRAME_US) {
      requestKeyframe(encoder)
    }
  }

  private fun requestKeyframe(encoder: Encoder) {
    encoder.codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
    encoder.syncRequested = true
  }

  /** The encoder drops camera frames (costs nothing) unless buffering or recording. */
  private fun updateRunning() {
    val encoder = encoder ?: return
    val run = wantBuffer || clip != null
    if (!run) buffer.clear()
    if (run == encoder.running) return
    encoder.running = run
    encoder.codec.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_SUSPEND, if (run) 0 else 1) })
    // A clip and the buffer can only begin at a keyframe.
    if (run) requestKeyframe(encoder)
  }

  private fun write(sample: EncodedSample) {
    val clip = clip ?: return
    var muxer = clip.muxer
    if (muxer == null) {
      val format = encoder?.format ?: return
      if (!sample.key) return
      muxer = MediaMuxer(clip.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer.setOrientationHint(rotation)
      clip.track = muxer.addTrack(format)
      muxer.start()
      clip.muxer = muxer
      clip.started.resolve(sample.timeUs / 1000.0)
    }
    val info = MediaCodec.BufferInfo()
    info.set(0, sample.data.size, sample.timeUs, if (sample.key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
    muxer.writeSampleData(clip.track, ByteBuffer.wrap(sample.data), info)
    clip.lastUs = sample.timeUs
  }

  /** Closes the current video; the camera time of its last frame, or null if nothing was written. */
  private fun finishClip(): Double? {
    val clip = clip ?: return null
    this.clip = null
    val muxer = clip.muxer
    if (muxer == null) {
      clip.started.reject(Error("Die Kamera hat keine Bilder geliefert."))
      return null
    }
    try {
      muxer.stop()
    } finally {
      muxer.release()
    }
    return clip.lastUs / 1000.0
  }
}
