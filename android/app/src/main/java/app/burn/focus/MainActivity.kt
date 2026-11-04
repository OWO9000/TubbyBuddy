package app.burn.focus

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import app.burn.focus.data.Permissions
import app.burn.focus.service.GuardService
import app.burn.focus.ui.shell.GuardSetupScreen
import app.burn.focus.ui.shell.NativeBridge
import app.burn.focus.ui.shell.ShellOffline
import app.burn.focus.ui.shell.ShellSplash
import app.burn.focus.ui.shell.ShellStatus
import app.burn.focus.ui.shell.buildWebView
import app.burn.focus.ui.theme.BurnColors
import app.burn.focus.ui.theme.BurnTheme
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The phone app shows the same screens as the web and Windows apps (loaded from the TubbyBuddy server), so copy,
 * rules and look never drift. Native code only does what a web page can't: the guard, its permissions and the
 * block screen.
 */
class MainActivity : ComponentActivity() {
  private var web: WebView? = null
  private var bridge: NativeBridge? = null
  private var status by mutableStateOf<ShellStatus>(ShellStatus.Loading)
  private var guardSetup by mutableStateOf(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }
    val repo = burnApp.repo
    if (intent?.getBooleanExtra("guard_setup", false) == true) guardSetup = true

    lifecycleScope.launch {
      repo.ensureSaved()
      val s = repo.state.first { it != null }!!
      if (s.guardEnabled && s.onboarded && Permissions.allRequired(this@MainActivity)) GuardService.start(this@MainActivity)
      repo.syncSoon()
      val (w, b) = buildWebView(
        this@MainActivity,
        bridgeFactory = { view -> NativeBridge(applicationContext, repo, lifecycleScope, view, { repo.state.value?.backendUrl.orEmpty() }, { guardSetup = true }) },
        origin = { repo.state.value?.backendUrl.orEmpty() },
        onStatus = { status = it },
      )
      web = w
      bridge = b
      w.loadUrl(s.backendUrl.trimEnd('/') + "/")
      render()
    }
    render()
  }

  private fun render() {
    setContent {
      BurnTheme {
        val state by burnApp.repo.state.collectAsStateWithLifecycle()
        val w = web
        BackHandler(enabled = !guardSetup) {
          if (w != null && w.canGoBack()) w.goBack() else moveTaskToBack(true)
        }
        Box(Modifier.fillMaxSize().background(BurnColors.Sky)) {
          if (w != null) {
            AndroidView(factory = { w }, modifier = Modifier.fillMaxSize().systemBarsPadding().imePadding())
          }
          when (val st = status) {
            is ShellStatus.Loading -> ShellSplash()
            is ShellStatus.Offline -> ShellOffline(st, onRetry = { url ->
              if (url != st.url && !burnApp.repo.setBackendUrl(url)) "That doesn't look like a web address."
              else { status = ShellStatus.Loading; reloadHome(); null }
            }, onGuard = { guardSetup = true })
            ShellStatus.Ready -> Unit
          }
          val s = state
          AnimatedVisibility(
            guardSetup && s != null,
            enter = fadeIn(tween(200)) + slideInVertically(tween(260)) { it / 12 },
            exit = fadeOut(tween(160)) + slideOutVertically(tween(200)) { it / 12 },
          ) {
            if (s != null) GuardSetupScreen(s, onClose = {
              guardSetup = false
              // A new server address takes effect right away.
              val origin = burnApp.repo.state.value?.backendUrl?.trimEnd('/').orEmpty()
              if (bridge?.pageUrl?.startsWith(origin) != true || status is ShellStatus.Offline) { status = ShellStatus.Loading; reloadHome() }
              // Let the shared Settings screen refresh its "Phone guard" line.
              web?.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null)
            })
          }
        }
      }
    }
  }

  private fun reloadHome() {
    lifecycleScope.launch { web?.loadUrl(burnApp.repo.current().backendUrl.trimEnd('/') + "/") }
  }

  override fun onResume() {
    super.onResume()
    burnApp.repo.syncSoon()
  }

  override fun onDestroy() {
    web?.destroy()
    web = null
    super.onDestroy()
  }
}
