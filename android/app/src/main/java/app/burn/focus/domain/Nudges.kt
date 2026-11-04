package app.burn.focus.domain

import kotlinx.serialization.Serializable
import kotlin.random.Random

@Serializable
data class Nudge(
  val id: String,
  val text: String,
  /** Package or app name this nudge was written for; null = any app. */
  val app: String? = null,
  val tone: String? = null,
  val source: String = "builtin",
)

@Serializable
data class NudgeCacheState(
  val nudges: List<Nudge> = emptyList(),
  val recent: List<String> = emptyList(),
  val fetchedAt: Long = 0,
)

data class NudgeContext(val appLabel: String, val points: Int, val atRisk: Int, val streak: Int, val goal: String)

object NudgeCache {
  const val MAX = 60
  const val RECENT = 6
  const val STALE_MS = 6 * 60 * 60_000L
  const val LOW_WATER = 12

  fun needsRefresh(s: NudgeCacheState, now: Long): Boolean =
    s.nudges.size < LOW_WATER || now - s.fetchedAt > STALE_MS

  /** Fresh nudges go first; duplicates (by id or text) are dropped; capped at [MAX]. */
  fun merge(s: NudgeCacheState, fresh: List<Nudge>, now: Long): NudgeCacheState {
    val seenIds = HashSet<String>()
    val seenText = HashSet<String>()
    val out = ArrayList<Nudge>()
    for (n in fresh + s.nudges) {
      val key = n.text.trim().lowercase()
      if (n.text.isBlank() || !seenIds.add(n.id) || !seenText.add(key)) continue
      out += n
      if (out.size == MAX) break
    }
    return s.copy(nudges = out, fetchedAt = now)
  }

  private fun matches(n: Nudge, appPkg: String, appLabel: String): Boolean =
    n.app == null || n.app.equals(appPkg, true) || n.app.equals(appLabel, true)

  /**
   * Picks a nudge for this app, preferring app-specific ones and avoiding the last few shown.
   * Falls back to [fallback] when the cache has nothing usable.
   */
  fun pick(
    s: NudgeCacheState,
    appPkg: String,
    appLabel: String,
    fallback: List<Nudge>,
    random: Random = Random.Default,
  ): Pair<Nudge, NudgeCacheState> {
    val pool = s.nudges.filter { matches(it, appPkg, appLabel) }.ifEmpty { fallback }
    val fresh = pool.filter { it.id !in s.recent }.ifEmpty { pool }
    val specific = fresh.filter { it.app != null }
    val choice = (if (specific.isNotEmpty() && random.nextInt(3) != 0) specific else fresh).random(random)
    val recent = (s.recent + choice.id).takeLast(RECENT)
    return choice to s.copy(recent = recent)
  }

  /** Fills {app} {points} {risk} {streak} {goal} placeholders. */
  fun render(text: String, c: NudgeContext): String = text
    .replace("{app}", c.appLabel)
    .replace("{points}", c.points.toString())
    .replace("{risk}", c.atRisk.toString())
    .replace("{streak}", c.streak.toString())
    .replace("{goal}", c.goal.ifBlank { "the stuff you actually care about" })
}

/** Offline set so the overlay always has something to say. Written for Burn. */
object BuiltinNudges {
  val all: List<Nudge> = listOf(
    "You opened {app} on autopilot. {risk} points are on the line. Worth it?",
    "Your {streak}-day streak is watching. Put {app} down and keep it alive.",
    "{risk} points is a real reward somewhere nearby. {app} will still be here later.",
    "Quick check: is this a choice or a reflex? You said you wanted {goal}.",
    "Thirty seconds of {app} turns into thirty minutes. Bank the points instead.",
    "Future you is cashing in those {points} points. Don't burn them on a scroll.",
    "Breathe in. Phone down. You just earned something better than a feed.",
    "Bored isn't an emergency. Let it pass and keep your {risk} points.",
    "You've got {points} points saved up. That's almost a free coffee. Keep going.",
    "{app} is designed to keep you. You're designed to leave. Prove it.",
    "Close {app} now and your companion stays happy. Continue and it watches {risk} points burn.",
    "Remember {goal}? This is the moment that decides it.",
  ).mapIndexed { i, t -> Nudge(id = "builtin-$i", text = t) }
}
