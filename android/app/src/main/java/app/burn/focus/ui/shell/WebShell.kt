package app.burn.focus.ui.shell

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.burn.focus.BuildConfig
import app.burn.focus.R
import app.burn.focus.ui.theme.AquaField
import app.burn.focus.ui.theme.AquaWindow
import app.burn.focus.ui.theme.BurnColors
import app.burn.focus.ui.theme.GelButton
import app.burn.focus.ui.theme.GelKind
import app.burn.focus.ui.theme.GroupBox
import app.burn.focus.ui.theme.PaperValley
import kotlinx.coroutines.launch

/** What the native layer shows while (or instead of) the shared screens. */
sealed interface ShellStatus {
  data object Loading : ShellStatus
  data object Ready : ShellStatus
  data class Offline(val url: String, val reason: String) : ShellStatus
}

@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
fun buildWebView(
  activity: android.app.Activity,
  bridgeFactory: (WebView) -> NativeBridge,
  origin: () -> String,
  onStatus: (ShellStatus) -> Unit,
): Pair<WebView, NativeBridge> {
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
  val web = WebView(activity)
  val bridge = bridgeFactory(web)
  web.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true
    mediaPlaybackRequiresUserGesture = false
    // The shared screens are laid out for this text size; system font scaling would push buttons out of their boxes.
    textZoom = 100
    cacheMode = WebSettings.LOAD_DEFAULT
    setSupportMultipleWindows(false)
    userAgentString = "$userAgentString TubbyBuddyAndroid/${BuildConfig.VERSION_NAME}"
  }
  web.setBackgroundColor(android.graphics.Color.parseColor("#ACE0FB"))
  web.isVerticalScrollBarEnabled = false
  web.addJavascriptInterface(bridge, "TubbyAndroid")
  web.webViewClient = object : WebViewClient() {
    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
      bridge.pageUrl = url
    }

    override fun onPageFinished(view: WebView, url: String) {
      bridge.pageUrl = url
      onStatus(ShellStatus.Ready)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val url = request.url.toString()
      val o = origin().trimEnd('/')
      if (url == o || url.startsWith("$o/")) return false
      // Download links, Google's own pages and anything else leave the app for the browser.
      runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
      return true
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
      if (request.isForMainFrame) onStatus(ShellStatus.Offline(origin(), error.description?.toString() ?: "No connection"))
    }
  }
  return web to bridge
}

/** Shown on top of the WebView until the first page is in, so nobody sees a blank white flash. */
@Composable
fun ShellSplash() {
  PaperValley(parallax = false) {
    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
      Image(
        painterResource(R.drawable.ic_launcher_fg), contentDescription = null,
        modifier = Modifier.size(104.dp).shadow(14.dp, RoundedCornerShape(24.dp)).clip(RoundedCornerShape(24.dp)),
      )
      Spacer(Modifier.height(14.dp))
      Text("TubbyBuddy", style = MaterialTheme.typography.titleLarge)
    }
  }
}

/** The server didn't answer. The guard keeps working; this screen lets you retry or point the app somewhere else. */
@Composable
fun ShellOffline(status: ShellStatus.Offline, onRetry: suspend (url: String) -> String?, onGuard: () -> Unit) {
  val scope = rememberCoroutineScope()
  var url by remember(status.url) { mutableStateOf(status.url) }
  var note by remember { mutableStateOf<String?>(null) }
  PaperValley {
    Box(Modifier.fillMaxSize().systemBarsPadding().padding(16.dp), contentAlignment = Alignment.Center) {
      AquaWindow("TubbyBuddy", Modifier.widthIn(max = 460.dp).fillMaxWidth()) {
        Text("Can't reach TubbyBuddy", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(6.dp))
        Text(
          "Your screens come from the TubbyBuddy server, and it isn't answering. The phone guard still works without it.",
          style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(12.dp))
        GroupBox {
          Text("Server address", style = MaterialTheme.typography.labelMedium)
          Spacer(Modifier.height(6.dp))
          AquaField(url, { url = it; note = null }, placeholder = "https://…")
          Text(status.reason, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
          note?.let { Text(it, style = MaterialTheme.typography.bodySmall.copy(color = BurnColors.Bad), modifier = Modifier.padding(top = 4.dp)) }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
          GelButton("Phone guard", onGuard, Modifier.weight(1f), kind = GelKind.Secondary)
          GelButton("Try again", {
            scope.launch { note = onRetry(url.trim()) }
          }, Modifier.weight(1f), throb = true)
        }
        if ("localhost" in status.url || "10.0.2.2" in status.url || "127.0.0.1" in status.url) {
          Text(
            "This build talks to a server on your computer. Start it there, then try again.",
            style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
          )
        }
      }
    }
  }
}
