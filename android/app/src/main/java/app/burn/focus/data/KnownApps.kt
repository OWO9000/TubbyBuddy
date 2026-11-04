package app.burn.focus.data

/** Package ids for the app names the shared screens use, so "TikTok" in the setup chat guards the real TikTok. */
object KnownApps {
  private val byName: Map<String, List<String>> = mapOf(
    "tiktok" to listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"),
    "instagram" to listOf("com.instagram.android"),
    "youtube" to listOf("com.google.android.youtube"),
    "x" to listOf("com.twitter.android"),
    "twitter" to listOf("com.twitter.android"),
    "reddit" to listOf("com.reddit.frontpage"),
    "snapchat" to listOf("com.snapchat.android"),
    "facebook" to listOf("com.facebook.katana"),
    "netflix" to listOf("com.netflix.mediaclient"),
    "twitch" to listOf("tv.twitch.android.app"),
    "discord" to listOf("com.discord"),
    "telegram" to listOf("org.telegram.messenger"),
    "whatsapp" to listOf("com.whatsapp"),
    "spotify" to listOf("com.spotify.music"),
    "pinterest" to listOf("com.pinterest"),
    "threads" to listOf("com.instagram.barcelona"),
    "steam" to listOf("com.valvesoftware.android.steam.community"),
  )

  fun packagesFor(name: String): List<String> = byName[name.trim().lowercase()].orEmpty()
}
