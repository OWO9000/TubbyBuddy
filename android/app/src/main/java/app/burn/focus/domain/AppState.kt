package app.burn.focus.domain

import kotlinx.serialization.Serializable

@Serializable
data class BlockedApp(val pkg: String, val label: String, val category: String = AppCategory.OTHER.id)

@Serializable
data class Stats(
  val putDowns: Int = 0,
  val burns: Int = 0,
  val pointsEarned: Int = 0,
  val pointsBurned: Int = 0,
  val redeems: Int = 0,
  val checkIns: Int = 0,
  /** epochDay -> minutes saved that day (last 30 days kept). */
  val savedMinutesByDay: Map<Long, Int> = emptyMap(),
  /** epochDay -> points earned from put-downs that day (for the daily cap). */
  val putDownPointsByDay: Map<Long, Int> = emptyMap(),
  /** package -> last time a put-down was logged (anti-farming window). */
  val lastPutDownAt: Map<String, Long> = emptyMap(),
  /** Last logged put-down across any app (global anti-farm gap). */
  val lastPutDownAtAny: Long? = null,
  /** epochDay -> distinct packages logged that day (daily variety cap). */
  val putDownAppsByDay: Map<Long, Set<String>> = emptyMap(),
  val lastBurnAt: Long = 0,
) {
  val totalSavedMinutes: Int get() = savedMinutesByDay.values.sum()
}

@Serializable
data class Redemption(
  val id: String,
  val offerId: String,
  val title: String,
  val business: String,
  val code: String,
  val points: Int,
  val at: Long,
  /** data:image/png;base64,... from the backend, or null to render [code] locally. */
  val qrDataUrl: String? = null,
  val offline: Boolean = false,
)

@Serializable
data class AppState(
  val deviceId: String = "",
  val onboarded: Boolean = false,
  val goals: String = "",
  val blockedApps: List<BlockedApp> = emptyList(),
  val ledger: LedgerState = LedgerState(),
  val streak: Streak = Streak(),
  val stats: Stats = Stats(),
  val owned: Set<String> = setOf(Cosmetics.DEFAULT_SKIN),
  /** slot name -> cosmetic id */
  val equipped: Map<String, String> = mapOf(Slot.SKIN.name to Cosmetics.DEFAULT_SKIN),
  val nudges: NudgeCacheState = NudgeCacheState(),
  val backendUrl: String = "",
  val guardEnabled: Boolean = false,
  val redemptions: List<Redemption> = emptyList(),
  val lastCheckInDay: Long? = null,
  val lastSyncAt: Long = 0,
  val lastSyncError: String? = null,
  val coach: CoachSettings = CoachSettings(),
  val chat: List<ChatMessage> = emptyList(),
  val greeting: String? = null,
  val greetedAt: Long = 0,
  val lastLine: String? = null,
  val serverAchievements: List<ServerAchievement> = emptyList(),
  /** Hard mode is chosen on the server (web Settings); cached here so the overlay quotes the real cost. */
  val hardMode: Boolean = false,
  /** Session from "Sign in with Google" (done in the browser). Null while the phone uses a guest profile. */
  val sessionToken: String? = null,
  val accountName: String? = null,
  val accountEmail: String? = null,
  val accountPicture: String? = null,
  /** The account finished setup on some device, so the shared screens skip onboarding here too. */
  val accountOnboarded: Boolean = false,
) {
  val signedIn: Boolean get() = !sessionToken.isNullOrBlank()
  val points: Int get() = ledger.balance
  val blockedPkgs: Set<String> get() = blockedApps.map { it.pkg }.toSet()
  fun labelFor(pkg: String): String = blockedApps.firstOrNull { it.pkg == pkg }?.label ?: pkg.substringAfterLast('.')
  val accessory: String? get() = Cosmetics.accessoryOf(equipped[Slot.ACCESSORY.name])
}
