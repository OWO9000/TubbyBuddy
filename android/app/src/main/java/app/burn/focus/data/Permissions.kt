package app.burn.focus.data

import android.Manifest
import android.annotation.SuppressLint
import android.app.AppOpsManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

enum class Perm(val title: String, val why: String, val required: Boolean) {
  USAGE("Usage access", "Lets TubbyBuddy see which app is on screen, so it can step in when you open one you chose to limit. Your usage history stays on the phone.", true),
  OVERLAY("Display over other apps", "Lets Tubby show the block screen on top of the apps you guard.", true),
  NOTIFICATIONS("Notifications", "Android shows a small notification while the guard is on, and Tubby sends the odd nudge.", false),
  BATTERY("Unrestricted battery", "Stops your phone from putting TubbyBuddy to sleep, so the guard keeps working all day.", false),
}

object Permissions {
  fun granted(ctx: Context, p: Perm): Boolean = when (p) {
    Perm.USAGE -> hasUsageAccess(ctx)
    Perm.OVERLAY -> Settings.canDrawOverlays(ctx)
    Perm.NOTIFICATIONS ->
      (Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
        NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    Perm.BATTERY -> ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)
  }

  fun allRequired(ctx: Context) = Perm.entries.filter { it.required }.all { granted(ctx, it) }

  @Suppress("DEPRECATION")
  fun hasUsageAccess(ctx: Context): Boolean {
    val ops = ctx.getSystemService(AppOpsManager::class.java)
    val mode = if (Build.VERSION.SDK_INT >= 29) ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    else ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    return if (mode == AppOpsManager.MODE_DEFAULT) {
      ctx.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
    } else mode == AppOpsManager.MODE_ALLOWED
  }

  /** Deep links into the exact settings page, with a generic fallback. */
  @SuppressLint("BatteryLife")
  fun settingsIntents(ctx: Context, p: Perm): List<Intent> {
    val pkgUri = Uri.parse("package:${ctx.packageName}")
    return when (p) {
      Perm.USAGE -> listOf(
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, pkgUri),
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS),
      )
      Perm.OVERLAY -> listOf(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri),
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
      )
      Perm.NOTIFICATIONS -> listOf(
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri),
      )
      Perm.BATTERY -> listOf(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri),
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri),
      )
    }.map { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
  }

  fun open(ctx: Context, p: Perm): Boolean {
    for (i in settingsIntents(ctx, p)) {
      try { ctx.startActivity(i); return true } catch (_: ActivityNotFoundException) { } catch (_: SecurityException) { }
    }
    return false
  }
}
