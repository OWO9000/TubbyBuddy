package app.burn.focus.domain

data class Outcome(val state: AppState, val points: Int, val minutes: Int = 0, val message: String? = null)

/** Pure state transitions. The repository persists the result; tests call these directly. */
object Actions {
  private const val KEEP_DAYS = 30

  private fun <V> Map<Long, V>.prune(today: Long) = filterKeys { it > today - KEEP_DAYS }

  private fun AppState.add(entry: LedgerEntry): Pair<AppState, LedgerEntry?> =
    when (val r = Ledger.append(ledger, entry)) {
      is LedgerResult.Ok -> copy(ledger = r.state) to r.entry
      is LedgerResult.Rejected -> this to null
    }

  /**
   * "Put the phone down": no points (being tempted isn't rewarded; points come from finished focus timers and check-ins).
   * The put-down is logged for badges and the Focus Score, at most once per app per window and with a global gap.
   */
  fun putDown(s: AppState, pkg: String, now: Long, today: Long, id: String): Outcome {
    val st0 = s.stats
    val last = st0.lastPutDownAt[pkg]
    val perAppOk = last == null || now - last >= PointsRules.REWARD_WINDOW_MS
    val globalOk = st0.lastPutDownAtAny?.let { now - it >= PointsRules.MIN_GAP_MS } ?: true
    val appsToday = st0.putDownAppsByDay[today] ?: emptySet()
    val varietyOk = pkg in appsToday || appsToday.size < PointsRules.MAX_RESISTED_APPS_PER_DAY
    val counted = perAppOk && globalOk && varietyOk
    val minutes = if (counted) PointsRules.MINUTES_SAVED_PER_PUT_DOWN else 0

    var st = s
    if (counted) st = st.add(LedgerEntry(id, EntryKind.EARN, 0, "Put down ${s.labelFor(pkg)}", now, pkg)).first
    val stats = st.stats.copy(
      putDowns = st.stats.putDowns + if (counted) 1 else 0,
      savedMinutesByDay = (st.stats.savedMinutesByDay + (today to ((st.stats.savedMinutesByDay[today] ?: 0) + minutes))).prune(today),
      lastPutDownAt = if (counted) st.stats.lastPutDownAt + (pkg to now) else st.stats.lastPutDownAt,
      lastPutDownAtAny = if (counted) now else st.stats.lastPutDownAtAny,
      putDownAppsByDay = if (counted) (st.stats.putDownAppsByDay + (today to (appsToday + pkg))).prune(today) else st.stats.putDownAppsByDay,
    )
    return Outcome(st.copy(stats = stats), 0, minutes, "Put down. Your points and streak are safe.")
  }

  /** "Continue anyway": burns points and resets the streak. */
  fun burn(s: AppState, pkg: String, now: Long, today: Long, id: String): Outcome {
    val amount = PointsRules.burnAmount(s.points, s.hardMode)
    val (st, e) = s.add(LedgerEntry(id, EntryKind.BURN, amount, "Opened ${s.labelFor(pkg)} anyway", now, pkg))
    val burned = e?.amount ?: 0
    val stats = st.stats.copy(burns = st.stats.burns + 1, pointsBurned = st.stats.pointsBurned + burned, lastBurnAt = now)
    return Outcome(st.copy(streak = StreakRules.onBurn(st.streak, today), stats = stats), burned)
  }

  /** Once-a-day check-in: keeps the streak (and pays the daily bonus) if nothing burned today. */
  fun checkIn(s: AppState, now: Long, today: Long, id: String): Outcome {
    if (s.lastCheckInDay == today) return Outcome(s, 0, message = "Already checked in today")
    if (s.streak.lastBurnDay == today) return Outcome(s.copy(lastCheckInDay = today), 0, message = "You burned today. Tomorrow is a fresh start.")
    val first = StreakRules.isFirstWinToday(s.streak, today)
    val streak = StreakRules.onWin(s.streak, today)
    var st = s.copy(lastCheckInDay = today, streak = streak, stats = s.stats.copy(checkIns = s.stats.checkIns + 1))
    var got = 0
    if (first) {
      val (n, e) = st.add(LedgerEntry(id, EntryKind.BONUS, PointsRules.streakBonus(streak.current), "Day ${streak.current} streak bonus", now))
      got = e?.amount ?: 0
      st = n.copy(stats = n.stats.copy(pointsEarned = n.stats.pointsEarned + got))
    }
    return Outcome(st, got, message = if (got > 0) "+$got points, day ${streak.current} streak" else "Checked in, streak kept")
  }

  fun buy(s: AppState, cosmeticId: String, now: Long, id: String): Outcome {
    val c = Cosmetics.byId(cosmeticId) ?: return Outcome(s, 0, message = "Unknown item")
    if (c.id in s.owned) return Outcome(equip(s, c.id), 0, message = "Equipped ${c.name}")
    if (c.price > 0) {
      val (st, e) = s.add(LedgerEntry(id, EntryKind.SPEND, c.price, "Bought ${c.name}", now, localOnly = true))
      if (e == null) return Outcome(s, 0, message = "Not enough points for ${c.name}")
      return Outcome(equip(st.copy(owned = st.owned + c.id), c.id), c.price, message = "Bought ${c.name}")
    }
    return Outcome(equip(s.copy(owned = s.owned + c.id), c.id), 0, message = "Equipped ${c.name}")
  }

  /** Wear an owned fur color (free colors count as owned). */
  fun equip(s: AppState, cosmeticId: String): AppState {
    val c = Cosmetics.byId(cosmeticId) ?: return s
    if (c.id !in s.owned && c.price > 0) return s
    return s.copy(equipped = s.equipped + (c.slot.name to c.id))
  }

  /** Finished focus session: +20 local points. The repository posts the real event when online. */
  fun focus(s: AppState, minutes: Int, now: Long, id: String, amount: Int = 20): Outcome {
    val (st, e) = s.add(LedgerEntry(id, EntryKind.BONUS, amount, "$minutes-minute focus session", now, localOnly = true))
    if (e == null) return Outcome(s, 0, message = "Could not add focus points")
    return Outcome(
      st.copy(stats = st.stats.copy(pointsEarned = st.stats.pointsEarned + amount)),
      amount,
      message = "+$amount points for $minutes minutes",
    )
  }

  fun redeem(s: AppState, r: Redemption, id: String): Outcome {    val (st, e) = s.add(LedgerEntry(id, EntryKind.REDEEM, r.points, "Redeemed ${r.title}", r.at, synced = !r.offline, localOnly = r.offline))
    if (e == null && r.points > 0) return Outcome(s, 0, message = "Not enough points")
    return Outcome(
      st.copy(redemptions = (listOf(r) + st.redemptions).take(50), stats = st.stats.copy(redeems = st.stats.redeems + 1)),
      r.points,
    )
  }

  fun savedMinutesToday(s: AppState, today: Long): Int = s.stats.savedMinutesByDay[today] ?: 0
}
