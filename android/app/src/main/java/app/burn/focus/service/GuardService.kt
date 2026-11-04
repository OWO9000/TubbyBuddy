package app.burn.focus.service

import android.app.Notification
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import app.burn.focus.BurnApp
import app.burn.focus.MainActivity
import app.burn.focus.R
import app.burn.focus.burnApp
import app.burn.focus.data.InstalledApps
import app.burn.focus.data.Permissions
import app.burn.focus.domain.AppState
import app.burn.focus.domain.FgEvent
import app.burn.focus.domain.ForegroundTracker
import app.burn.focus.domain.GateDecision
import app.burn.focus.domain.InterceptGate
import app.burn.focus.domain.Outcome
import app.burn.focus.domain.PointsRules
import app.burn.focus.domain.StreakRules
import app.burn.focus.ui.companion.CompanionSpec
import app.burn.focus.ui.companion.Mood
import app.burn.focus.ui.overlay.OverlayModel
import app.burn.focus.ui.overlay.OverlayScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Foreground service: polls UsageStatsManager every ~700 ms for the newest foreground app and
 * shows the intercept overlay when a blocked app comes to the front.
 */
class GuardService : LifecycleService() {
  private lateinit var overlay: OverlayController
  private lateinit var gate: InterceptGate
  private val tracker = ForegroundTracker()
  private var launchers: Set<String> = emptySet()
  @Volatile private var latest: AppState? = null
  private var pollJob: Job? = null
  private var lastQueryEnd = 0L
  private var lastSyncAttempt = 0L

  override fun onCreate() {
    super.onCreate()
    overlay = OverlayController(this)
    gate = InterceptGate(packageName)
    launchers = runCatching { InstalledApps.launchers(this) }.getOrDefault(emptySet())
    goForeground("Starting…")
    val repo = burnApp.repo
    lifecycleScope.launch {
      repo.state.filterNotNull().collect { latest = it }
    }
    lifecycleScope.launch {
      repo.state.filterNotNull().map { it.blockedApps.size to it.points }.distinctUntilChanged().collect { (n, pts) ->
        updateNotification(if (n == 0) "No apps chosen yet" else "Guarding $n app${if (n == 1) "" else "s"} · $pts pts")
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)
    when (intent?.action) {
      ACTION_STOP -> {
        lifecycleScope.launch { burnApp.repo.setGuardEnabled(false) }
        overlay.hide()
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_PREVIEW -> lifecycleScope.launch { showIntercept(intent.getStringExtra(EXTRA_PKG) ?: PREVIEW_PKG, preview = true) }
    }
    if (pollJob?.isActive != true) pollJob = lifecycleScope.launch { pollLoop() }
    return START_STICKY
  }

  override fun onDestroy() {
    overlay.hide()
    super.onDestroy()
  }

  private suspend fun pollLoop() {
    val usm = getSystemService(UsageStatsManager::class.java)
    val power = getSystemService(PowerManager::class.java)
    lastQueryEnd = System.currentTimeMillis() - 60_000
    while (lifecycleScope.coroutineContext.isActive) {
      val state = latest
      if (state != null && power.isInteractive && Permissions.hasUsageAccess(this)) {
        val now = System.currentTimeMillis()
        val events = withContext(Dispatchers.Default) { readEvents(usm, lastQueryEnd - 500, now) }
        lastQueryEnd = now
        val fg = tracker.ingest(events)
        when (val d = gate.onForeground(fg, now, state.blockedPkgs, launchers - state.blockedPkgs)) {
          is GateDecision.Show -> showIntercept(d.pkg, preview = false)
          is GateDecision.Hide -> {
            // Left the app while the overlay was up (Home / Recents): that counts as putting it down.
            overlay.hide()
            gate.onPutDown(now)
            burnApp.repo.putDown(d.pkg)
          }
          GateDecision.None -> Unit
        }
        if (now - lastSyncAttempt > SYNC_EVERY_MS) {
          lastSyncAttempt = now
          burnApp.repo.syncSoon()
        }
      }
      delay(if (power.isInteractive) POLL_MS else IDLE_POLL_MS)
    }
  }

  private fun readEvents(usm: UsageStatsManager, from: Long, to: Long): List<FgEvent> {
    val out = ArrayList<FgEvent>()
    val ev = usm.queryEvents(from, to) ?: return out
    val e = UsageEvents.Event()
    while (ev.hasNextEvent()) {
      ev.getNextEvent(e)
      @Suppress("DEPRECATION")
      when (e.eventType) {
        UsageEvents.Event.MOVE_TO_FOREGROUND -> out += FgEvent(e.packageName, FgEvent.RESUMED, e.timeStamp)
        UsageEvents.Event.MOVE_TO_BACKGROUND -> out += FgEvent(e.packageName, FgEvent.PAUSED, e.timeStamp)
      }
    }
    return out
  }

  private suspend fun showIntercept(pkg: String, preview: Boolean) {
    val repo = burnApp.repo
    val s = repo.current()
    if (preview) gate.forceShow(pkg)
    val label = if (pkg == PREVIEW_PKG) "TikTok" else s.labelFor(pkg)
    val nudge = repo.nextNudge(pkg, label)
    val model = OverlayModel(
      pkg = pkg,
      appLabel = label,
      nudge = nudge,
      points = s.points,
      atRisk = PointsRules.burnAmount(s.points, s.hardMode),
      streak = StreakRules.displayed(s.streak, repo.today()),
      spec = CompanionSpec.from(s, Mood.WORRIED),
      preview = preview,
    )
    val shown = overlay.show {
      OverlayScreen(
        model = model,
        onPutDown = {
          gate.onPutDown(System.currentTimeMillis())
          if (!preview) goHome()
          if (preview) Outcome(s, 0, message = "Put down (preview)")
          else repo.putDown(pkg)
        },
        onBurn = {
          if (preview) { gate.dismissSilently(); Outcome(s, model.atRisk) }
          else repo.burn(pkg).also { gate.onContinue(System.currentTimeMillis()) }
        },
        onFinished = { overlay.hide() },
      )
    }
    if (!shown) gate.dismissSilently()
  }

  private fun goHome() {
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { startActivity(home) }
  }

  private fun buildNotification(text: String): Notification {
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, GuardService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, BurnApp.GUARD_CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_tubby)
      .setContentTitle("TubbyBuddy is on guard")
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(open)
      .addAction(0, "Pause guard", stop)
      .build()
  }

  private fun goForeground(text: String) {
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(text), type)
  }

  private fun updateNotification(text: String) {
    if (Permissions.granted(this, app.burn.focus.data.Perm.NOTIFICATIONS)) {
      @Suppress("MissingPermission")
      NotificationManagerCompat.from(this).notify(NOTIF_ID, buildNotification(text))
    }
  }

  companion object {
    private const val NOTIF_ID = 42
    private const val POLL_MS = 700L
    private const val IDLE_POLL_MS = 3_000L
    private const val SYNC_EVERY_MS = 5 * 60_000L
    const val ACTION_STOP = "app.burn.focus.STOP"
    const val ACTION_PREVIEW = "app.burn.focus.PREVIEW"
    const val EXTRA_PKG = "pkg"
    const val PREVIEW_PKG = "preview.tiktok"

    fun start(ctx: Context) {
      ContextCompat.startForegroundService(ctx, Intent(ctx, GuardService::class.java))
    }

    fun stop(ctx: Context) {
      ctx.startService(Intent(ctx, GuardService::class.java).setAction(ACTION_STOP))
    }

    fun preview(ctx: Context) {
      ContextCompat.startForegroundService(ctx, Intent(ctx, GuardService::class.java).setAction(ACTION_PREVIEW))
    }
  }
}
