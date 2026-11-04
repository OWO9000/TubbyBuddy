package app.burn.focus.data

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import androidx.core.graphics.drawable.toBitmap
import app.burn.focus.domain.AppCategory

data class LaunchableApp(
  val pkg: String,
  val label: String,
  val icon: Bitmap?,
  val suggested: Boolean,
  val category: AppCategory = AppCategory.OTHER,
)

object InstalledApps {
  /** Usual suspects, pre-selected when installed. */
  val SUGGESTED = setOf(
    "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.instagram.android", "com.google.android.youtube",
    "com.twitter.android", "com.reddit.frontpage", "com.snapchat.android", "com.facebook.katana",
    "com.pinterest", "tv.twitch.android.app", "com.instagram.barcelona",
  )

  fun launchable(ctx: Context): List<LaunchableApp> {
    val pm = ctx.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(intent, 0)
      .asSequence()
      .map { it.activityInfo.applicationInfo }
      .filter { it.packageName != ctx.packageName }
      .distinctBy { it.packageName }
      .map { ai ->
        val icon = runCatching { pm.getApplicationIcon(ai).toBitmap(96, 96) }.getOrNull()
        val label = pm.getApplicationLabel(ai).toString()
        LaunchableApp(
          pkg = ai.packageName,
          label = label,
          icon = icon,
          suggested = ai.packageName in SUGGESTED,
          category = categoryOf(ai, label),
        )
      }
      .sortedWith(compareByDescending<LaunchableApp> { it.suggested }.thenBy { it.label.lowercase() })
      .toList()
  }

  /** Home screen apps: never treated as "the app in front" for blocking decisions. */
  fun launchers(ctx: Context): Set<String> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return ctx.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      .map { it.activityInfo.packageName }.toSet()
  }

  /** ApplicationInfo.category is a strong signal; package/label heuristics fill the gaps. */
  private fun categoryOf(ai: ApplicationInfo, label: String): AppCategory {
    when (ai.category) {
      ApplicationInfo.CATEGORY_GAME -> return AppCategory.GAMES
      ApplicationInfo.CATEGORY_AUDIO -> return AppCategory.MUSIC
      ApplicationInfo.CATEGORY_VIDEO -> return AppCategory.VIDEO
      ApplicationInfo.CATEGORY_SOCIAL -> return AppCategory.SOCIAL
      ApplicationInfo.CATEGORY_NEWS -> return AppCategory.NEWS
      ApplicationInfo.CATEGORY_MAPS -> return AppCategory.TRAVEL
      ApplicationInfo.CATEGORY_PRODUCTIVITY -> return AppCategory.PRODUCTIVITY
      ApplicationInfo.CATEGORY_IMAGE -> return AppCategory.PHOTOS
      // Accessibility and undefined say nothing about distraction: fall through to the name heuristics.
      ApplicationInfo.CATEGORY_ACCESSIBILITY, ApplicationInfo.CATEGORY_UNDEFINED -> Unit
    }
    val key = (ai.packageName + " " + label).lowercase()
    fun any(vararg words: String) = words.any { it in key }

    return when {
      any("whatsapp", "telegram", "signal", "messenger", "discord", "slack", "teams", "zoom", "skype", "viber", "wechat", "kakaotalk") ->
        AppCategory.COMMUNICATION
      any("tiktok", "musically", "instagram", "facebook", "twitter", "snapchat", "reddit", "pinterest", "linkedin", "threads", "tumblr", "mastodon", "bluesky", "weibo", "douyin") ->
        AppCategory.SOCIAL
      any("youtube", "netflix", "twitch", "hulu", "disney", "prime video", "hbo", "max", "peacock", "vimeo", "plex", "crunchyroll", "bilibili", "iqiyi") ->
        AppCategory.VIDEO
      any("game", "supercell", "king.com", "rovio", "gameloft", "electronic arts", "ea.", "epicgames", "mihoyo", "riot", "zynga", "playrix", "miniclip", "outfit7", "sega", "ubisoft", "bandai", "square_enix") ->
        AppCategory.GAMES
      any("spotify", "soundcloud", "deezer", "tidal", "pandora", "audible", "podcast", "music") ->
        AppCategory.MUSIC
      any("amazon", "ebay", "temu", "shein", "aliexpress", "etsy", "walmart", "target", "shop", "store", "alibaba", "flipkart", "mercari", "poshmark", "depop", "ikea") ->
        AppCategory.SHOPPING
      any("bbc", "cnn", "nytimes", "guardian", "reuters", "news", "medium", "substack") ->
        AppCategory.NEWS
      any("notion", "todoist", "ticktick", "evernote", "onenote", "docs", "sheets", "slides", "drive", "dropbox", "calendar", "gmail", "outlook", "trello", "asana", "jira") ->
        AppCategory.PRODUCTIVITY
      any("photos", "gallery", "camera") -> AppCategory.PHOTOS
      any("maps", "uber", "lyft", "airbnb", "booking", "expedia", "tripadvisor", "transit", "citymapper") ->
        AppCategory.TRAVEL
      else -> AppCategory.OTHER
    }
  }
}
