package com.margelo.nitro.nomol

import android.media.AudioManager
import android.media.ToneGenerator
import android.util.Log

/** A system tone needs no sound file or media player library. */
class HybridStartSound : HybridStartSoundSpec() {
  /**
   * Created on the first beep: the constructor throws when the system has no audio resources
   * left, and a missing beep mustn't take the app down.
   */
  private var tone: ToneGenerator? = null

  override fun play() {
    try {
      val tone = tone ?: ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME).also { tone = it }
      // Two beeps, like the web app, loud enough to hear across the hall.
      tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 400)
    } catch (e: RuntimeException) {
      Log.w("NomolSound", "No start beep", e)
    }
  }

  override fun dispose() {
    super.dispose()
    tone?.release()
    tone = null
  }
}
