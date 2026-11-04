package app.burn.focus.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.burn.focus.burnApp
import app.burn.focus.data.Permissions
import kotlinx.coroutines.launch

/** Restarts the guard after a reboot or app update if it was on. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val pending = goAsync()
    val app = context.burnApp
    app.appScope.launch {
      try {
        val s = app.repo.current()
        if (s.guardEnabled && s.onboarded && Permissions.allRequired(context)) GuardService.start(context)
      } catch (_: Exception) {
      } finally {
        pending.finish()
      }
    }
  }
}
