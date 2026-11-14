package com.margelo.nitro.nomol

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules

/** Video and body points go out together, as on the web, so they don't get separated. */
@Keep
@DoNotStrip
class HybridFileShare : HybridFileShareSpec() {
  override fun share(
    uris: Array<String>,
    title: String,
  ) {
    val context = NitroModules.applicationContext ?: throw Error("No application context")
    val parsed = uris.map(Uri::parse)
    val clip = ClipData.newRawUri(title, parsed.first())
    parsed.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
    val send =
      Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = "*/*"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(parsed))
        putExtra(Intent.EXTRA_TITLE, title)
        // The receiving app needs the grant for every file, not just the first.
        clipData = clip
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    val chooser =
      Intent.createChooser(send, title).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    context.startActivity(chooser)
  }
}
