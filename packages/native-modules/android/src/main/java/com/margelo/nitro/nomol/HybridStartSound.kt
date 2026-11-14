package com.margelo.nitro.nomol

import android.media.AudioManager
import android.media.ToneGenerator

/** A system tone needs no sound file or media player library. */
class HybridStartSound : HybridStartSoundSpec() {
  private val tone = ToneGenerator(AudioManager.STREAM_MUSIC, ToneGenerator.MAX_VOLUME)

  override fun play() {
    // Two beeps, like the web app, loud enough to hear across the hall.
    tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 400)
  }

  override fun dispose() {
    super.dispose()
    tone.release()
  }
}
