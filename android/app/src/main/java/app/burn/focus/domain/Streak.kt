package app.burn.focus.domain

import kotlinx.serialization.Serializable

/** Days are epoch days in the user's local zone (LocalDate.toEpochDay()). */
@Serializable
data class Streak(
  val current: Int = 0,
  val best: Int = 0,
  val lastWinDay: Long? = null,
  val lastBurnDay: Long? = null,
)

object StreakRules {
  /** A disciplined action today (put the phone down, or a clean check-in). */
  fun onWin(s: Streak, day: Long): Streak {
    val next = when (s.lastWinDay) {
      day -> maxOf(s.current, 1)
      day - 1 -> s.current + 1
      else -> 1
    }
    return s.copy(current = next, best = maxOf(s.best, next), lastWinDay = day)
  }

  /** Breaking a rule resets the streak. */
  fun onBurn(s: Streak, day: Long): Streak = s.copy(current = 0, lastWinDay = null, lastBurnDay = day)

  /** The streak shown to the user: it lapses if yesterday had no win. */
  fun displayed(s: Streak, today: Long): Int {
    val last = s.lastWinDay ?: return 0
    return if (last >= today - 1) s.current else 0
  }

  fun isFirstWinToday(s: Streak, today: Long): Boolean = s.lastWinDay != today
}
