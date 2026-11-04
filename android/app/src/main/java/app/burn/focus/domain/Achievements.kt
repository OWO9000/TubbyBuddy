package app.burn.focus.domain

data class Achievement(val id: String, val name: String, val description: String, val unlocked: Boolean, val progress: Float)

object Achievements {
  private fun p(v: Int, target: Int) = (v.toFloat() / target).coerceIn(0f, 1f)

  fun of(s: AppState, today: Long): List<Achievement> {
    val st = s.stats
    val streakNow = StreakRules.displayed(s.streak, today)
    fun a(id: String, name: String, desc: String, v: Int, target: Int) = Achievement(id, name, desc, v >= target, p(v, target))
    return listOf(
      a("first-resist", "Put It Down", "Resist a blocked app once", st.putDowns, 1),
      a("resist-10", "Iron Thumb", "Resist 10 times", st.putDowns, 10),
      a("streak-3", "On a Roll", "Reach a 3-day streak", s.streak.best, 3),
      a("streak-7", "Week Warrior", "Reach a 7-day streak", s.streak.best, 7),
      a("earned-100", "Centurion", "Earn 100 points in total", st.pointsEarned, 100),
      a("saved-60", "Hour Reclaimed", "Save 60 minutes of scrolling", st.totalSavedMinutes, 60),
      a("first-redeem", "Real Life Unlocked", "Redeem a real-world reward", st.redeems, 1),
      a("first-cosmetic", "Drip", "Buy your first companion cosmetic", s.owned.size - 1, 1),
      Achievement(
        "phoenix", "Phoenix", "Burn once, then build a 2-day streak",
        st.burns >= 1 && streakNow >= 2, if (st.burns >= 1) p(streakNow, 2) else 0f,
      ),
    )
  }
}
