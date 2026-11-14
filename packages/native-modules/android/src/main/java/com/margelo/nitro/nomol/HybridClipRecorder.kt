package com.margelo.nitro.nomol

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.annotation.Keep
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import com.facebook.proguard.annotations.DoNotStrip
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

private const val TAG = "NomolRecorder"

/**
 * Records clips with its own H.264 encoder. CameraX allows a single video recording at a time
 * and its recorder can't begin before it is started, so a second Preview use case feeds
 * MediaCodec's input surface instead. Encoder output carries the camera's capture timestamps,
 * though not necessarily in the clock of the detected frames ([CameraClock]); inside, all times
 * are BOOTTIME µs, and JS gets and gives frame times, so a video's time 0 is exactly its first
 * frame's capture time.
 */
@Keep
@DoNotStrip
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

    /** The encoder whose stream the muxer was set up for. */
    var source: Encoder? = null
  }

  /** The encoder of the surface the camera currently delivers to. */
  private class Encoder(
    val codec: MediaCodec,
  ) {
    var format: MediaFormat? = null
    var running = true
    var lastKeyUs = Long.MIN_VALUE
    var syncRequested = false

    /** The clock of its timestamps, from its first sample. */
    var clock: Clock? = null
  }

  // Everything below is used on `thread` only.
  private val buffer = SampleBuffer(BUFFER_US)
  private var encoder: Encoder? = null
  private var clip: Clip? = null
  private var wantBuffer = false

  /** Why there is no working encoder, reported by the next `start` or `stop`. */
  private var failure: String? = null

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
      val failure = failure
      if (encoder == null && failure != null) {
        started.reject(Error(failure))
        return@post
      }
      File(path).parentFile?.mkdirs()
      clip = Clip(path, started)
      updateRunning()
      val current = encoder ?: return@post
      for (sample in buffer.takeFrom(frameToUs(fromMs))) write(sample, current)
    }
    return started
  }

  override fun stop(): Promise<Double> {
    val stopped = Promise<Double>()
    handler.post {
      try {
        val ended = finishClip()
        if (ended != null) stopped.resolve(ended) else stopped.reject(Error(failure ?: "Das Video ist leer."))
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
    var codec: MediaCodec? = null
    val encoder: Encoder
    val surface: Surface
    try {
      val created = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
      codec = created
      encoder = Encoder(created)
      // Callbacks run on `thread`, like everything else here.
      created.setCallback(Callback(encoder), handler)
      created.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      surface = created.createInputSurface()
      created.start()
    } catch (e: Exception) {
      Log.w(TAG, "Could not start the encoder", e)
      codec?.let { runCatching { it.release() } }
      // Otherwise the camera waits for this surface and shows nothing at all.
      request.willNotProvideSurface()
      failEncoder(null, e)
      return
    }
    // Samples of the previous encoder have another stream's settings; a clip being written
    // ignores the new one's samples and ends at its last frame (`write`).
    buffer.clear()
    this.encoder = encoder
    failure = null
    updateRunning()

    request.setTransformationInfoListener(executor) { rotation = it.rotationDegrees }
    request.provideSurface(surface, executor) {
      // The camera no longer delivers here (session closed or reconfigured). A clip being
      // written keeps what it has; `stop` finishes it.
      if (this.encoder === encoder) {
        this.encoder = null
        buffer.clear()
      }
      // A failed encoder may refuse these; it is released either way.
      runCatching { encoder.codec.stop() }
      runCatching { encoder.codec.release() }
      surface.release()
    }
  }

  /**
   * The encoder can't be used any more. A clip being written keeps what it has and `stop`
   * finishes it; the error is reported by the next `start` or `stop`.
   */
  private fun failEncoder(
    failed: Encoder?,
    e: Exception,
  ) {
    failure = "Der Video-Encoder ist ausgefallen: ${e.message ?: e.javaClass.simpleName}"
    if (failed == null || failed !== encoder) return
    encoder = null
    buffer.clear()
    // Not from inside its own callback.
    handler.post { runCatching { failed.codec.release() } }
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
      val ptsNs = info.presentationTimeUs * 1000
      val clock = owner.clock ?: CameraClock.detect(ptsNs, "Encoder").also { owner.clock = it }
      val timeUs = toBoottime(ptsNs, clock, CameraClock.offsetNs()) / 1000
      val sample = EncodedSample(bytes, timeUs, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0)
      keepKeyframesClose(owner, sample)
      if (clip != null) {
        write(sample, owner)
      } else if (wantBuffer) {
        buffer.add(sample)
      }
    }

    override fun onError(
      codec: MediaCodec,
      e: MediaCodec.CodecException,
    ) {
      Log.w(TAG, "Encoder error", e)
      failEncoder(owner, e)
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
    setParameter(encoder, MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
    encoder.syncRequested = true
  }

  /** A failed codec refuses parameters; `onError` deals with that, so this mustn't crash the thread. */
  private fun setParameter(
    encoder: Encoder,
    key: String,
    value: Int,
  ) {
    runCatching { encoder.codec.setParameters(Bundle().apply { putInt(key, value) }) }
      .onFailure { Log.w(TAG, "Could not set $key", it) }
  }

  /** The encoder drops camera frames (costs nothing) unless buffering or recording. */
  private fun updateRunning() {
    val encoder = encoder ?: return
    val run = wantBuffer || clip != null
    if (!run) buffer.clear()
    if (run == encoder.running) return
    encoder.running = run
    setParameter(encoder, MediaCodec.PARAMETER_KEY_SUSPEND, if (run) 0 else 1)
    // A clip and the buffer can only begin at a keyframe.
    if (run) requestKeyframe(encoder)
  }

  /** Writes a sample of [from] into the current clip. */
  private fun write(
    sample: EncodedSample,
    from: Encoder,
  ) {
    val clip = clip ?: return
    var muxer = clip.muxer
    if (muxer == null) {
      val format = from.format ?: return
      if (!sample.key) return
      muxer = MediaMuxer(clip.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer.setOrientationHint(rotation)
      clip.track = muxer.addTrack(format)
      muxer.start()
      clip.muxer = muxer
      clip.source = from
      clip.started.resolve(usToFrame(sample.timeUs))
    } else if (from !== clip.source) {
      // The camera was set up anew mid-clip (other size, new codec config); its samples would
      // break the file, so the video ends at the old encoder's last frame.
      return
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
    return usToFrame(clip.lastUs)
  }

  /** Before the first detected frame, frame times are taken as BOOTTIME, as on most phones. */
  private fun frameClock() = CameraClock.frames ?: Clock.BOOTTIME

  /** A frame time in ms, as JS has it, in this recorder's BOOTTIME µs. */
  private fun frameToUs(ms: Double) = toBoottime((ms * 1e6).toLong(), frameClock(), CameraClock.offsetNs()) / 1000

  /** [frameToUs] reversed. */
  private fun usToFrame(us: Long) = fromBoottime(us * 1000, frameClock(), CameraClock.offsetNs()) / 1e6
}
