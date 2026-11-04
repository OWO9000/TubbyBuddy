package app.burn.focus.ui.shell

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import app.burn.focus.data.BurnRepository
import app.burn.focus.data.InstalledApps
import app.burn.focus.data.Permissions
import app.burn.focus.service.GuardService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * `window.TubbyAndroid` for the shared screens: the same jobs the Windows app's bridge does (profile id, session,
 * sign-in in the system browser, demo, sign-out), plus the phone guard. Async calls answer through
 * `window.__tubbyNative(id, json)`. Calls are only honoured while the WebView shows the TubbyBuddy server.
 */
class NativeBridge(
  private val ctx: Context,
  private val repo: BurnRepository,
  private val scope: CoroutineScope,
  private val web: WebView,
  private val trustedOrigin: () -> String,
  private val openGuardSetup: () -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())

  @Volatile var pageUrl: String = ""

  private fun trusted(): Boolean {
    val origin = trustedOrigin().trimEnd('/')
    return origin.isNotEmpty() && (pageUrl == origin || pageUrl.startsWith("$origin/"))
  }

  @JavascriptInterface
  fun deviceId(): String = if (trusted()) repo.state.value?.deviceId.orEmpty() else ""

  @JavascriptInterface
  fun session(): String = if (trusted()) repo.state.value?.sessionToken.orEmpty() else ""

  @JavascriptInterface
  fun call(method: String, argJson: String, callbackId: String) {
    if (!trusted()) return reply(callbackId, false, null, "Not allowed here")
    val arg = runCatching { JSONObject(argJson) }.getOrDefault(JSONObject())
    scope.launch {
      try {
        val value = handle(method, arg)
        reply(callbackId, true, value, null)
      } catch (e: Exception) {
        reply(callbackId, false, null, e.message ?: "Something went wrong on the phone")
      }
    }
  }

  private fun reloadSoon() = main.postDelayed({ web.reload() }, 150)

  private suspend fun handle(method: String, arg: JSONObject): Any? = when (method) {
    "account" -> {
      val s = repo.current()
      if (!s.signedIn) JSONObject.NULL
      else JSONObject()
        .put("name", s.accountName ?: JSONObject.NULL)
        .put("email", s.accountEmail ?: JSONObject.NULL)
        .put("picture", s.accountPicture ?: JSONObject.NULL)
        .put("profileId", s.deviceId)
        .put("onboarded", s.accountOnboarded)
    }
    "signIn" -> signIn()
    "signOut" -> { repo.signOut(); reloadSoon(); true }
    "useDemo" -> { repo.useDemoProfile(); reloadSoon(); true }
    "applySetup" -> {
      val names = arg.optJSONArray("apps")?.let { a -> List(a.length()) { a.optString(it) } }.orEmpty()
      val installed = withContext(Dispatchers.IO) { InstalledApps.launchable(ctx) }
      repo.applySetupNames(names, installed)
      if (Permissions.allRequired(ctx)) GuardService.start(ctx)
      true
    }
    "guardStatus" -> {
      val s = repo.current()
      JSONObject()
        .put("enabled", s.guardEnabled)
        .put("permissionsOk", Permissions.allRequired(ctx))
        .put("blocked", JSONArray(s.blockedApps.map { it.label }))
    }
    "openGuardSetup" -> { main.post(openGuardSetup); true }
    else -> throw IllegalArgumentException("Unknown call: $method")
  }

  /** Same flow as the Windows app: a one-time link opens in the browser, the phone polls until it's approved. */
  private suspend fun signIn(): JSONObject {
    val url = repo.beginSignIn()
    if (url == null) {
      val st = repo.signIn.value
      val msg = (st as? BurnRepository.SignInState.Failed)?.message ?: "Sign-in is already open in your browser."
      return JSONObject().put("ok", false).put("error", msg)
    }
    main.post {
      runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
    val end = withTimeoutOrNull(11 * 60_000L) {
      repo.signIn.first { it is BurnRepository.SignInState.Done || it is BurnRepository.SignInState.Failed }
    }
    return when (end) {
      is BurnRepository.SignInState.Done -> { repo.clearSignInState(); reloadSoon(); JSONObject().put("ok", true) }
      is BurnRepository.SignInState.Failed -> { repo.clearSignInState(); JSONObject().put("ok", false).put("error", end.message) }
      else -> JSONObject().put("ok", false).put("error", "Sign-in timed out. Try again.")
    }
  }

  private fun reply(id: String, ok: Boolean, value: Any?, error: String?) {
    val payload = JSONObject().put("ok", ok)
    if (value != null) payload.put("value", value)
    if (error != null) payload.put("error", error)
    val js = "window.__tubbyNative && window.__tubbyNative(${JSONObject.quote(id)}, ${JSONObject.quote(payload.toString())})"
    main.post { web.evaluateJavascript(js, null) }
  }
}
