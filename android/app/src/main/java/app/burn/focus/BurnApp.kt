package app.burn.focus

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import app.burn.focus.data.BurnRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class BurnApp : Application() {
  val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  lateinit var repo: BurnRepository
    private set

  override fun onCreate() {
    super.onCreate()
    repo = BurnRepository(this, appScope)
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(GUARD_CHANNEL, getString(R.string.channel_guard), NotificationManager.IMPORTANCE_LOW).apply {
        description = getString(R.string.channel_guard_desc)
        setShowBadge(false)
      },
    )
  }

  companion object {
    const val GUARD_CHANNEL = "guard"
  }
}

val android.content.Context.burnApp: BurnApp get() = applicationContext as BurnApp
