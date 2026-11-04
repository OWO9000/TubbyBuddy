package app.burn.focus.domain

/**
 * Coarse app buckets, Android exposes a few categories on
 * ApplicationInfo; the rest are inferred from the package/label so a whole category can be blocked
 * without hand-picking every app.
 */
enum class AppCategory(val id: String, val label: String, val emoji: String) {
  SOCIAL("social", "Social", "💬"),
  VIDEO("video", "Video & streaming", "📺"),
  GAMES("games", "Games", "🎮"),
  MUSIC("music", "Music & audio", "🎧"),
  NEWS("news", "News & reading", "📰"),
  SHOPPING("shopping", "Shopping", "🛍️"),
  COMMUNICATION("communication", "Messaging", "✉️"),
  PRODUCTIVITY("productivity", "Productivity", "🗂️"),
  PHOTOS("photos", "Photos", "📷"),
  TRAVEL("travel", "Travel & maps", "🗺️"),
  OTHER("other", "Other", "📦");

  companion object {
    fun fromId(id: String?): AppCategory = entries.firstOrNull { it.id == id } ?: OTHER
  }
}
