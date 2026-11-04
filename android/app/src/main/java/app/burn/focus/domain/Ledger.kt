package app.burn.focus.domain

import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

@Serializable
enum class EntryKind(val sign: Int, val wire: String) {
  /** Put a guarded app down. Logged (badges, Focus Score) with amount 0: points come from finished focus timers. */
  EARN(+1, "resisted_temptation"),
  /** Streak / daily check-in bonus. */
  BONUS(+1, "streak_bonus"),
  /** Pressed "Continue anyway". */
  BURN(-1, "burned"),
  /** Bought a cosmetic. */
  SPEND(-1, "cosmetic"),
  /** Redeemed a real-world offer. */
  REDEEM(-1, "redeem"),
}

@Serializable
data class LedgerEntry(
  val id: String,
  val kind: EntryKind,
  /** Always positive; the sign comes from [kind]. */
  val amount: Int,
  val reason: String,
  val at: Long,
  val app: String? = null,
  val synced: Boolean = false,
  /** Never sent to the backend (e.g. cosmetics drawn on-device, offline demo redemptions). */
  val localOnly: Boolean = false,
) {
  val delta: Int get() = kind.sign * amount
}

/**
 * Append-only points ledger. Old synced entries are folded into [archivedBalance] so the
 * stored list stays small; unsynced entries are never folded away. [localAdjust] remembers the
 * folded local-only deltas so a rebase onto the server balance keeps them.
 */
@Serializable
data class LedgerState(
  val entries: List<LedgerEntry> = emptyList(),
  val archivedBalance: Int = 0,
  val localAdjust: Int = 0,
) {
  val balance: Int get() = archivedBalance + entries.sumOf { it.delta }
  /** Entries that still need to reach the backend. */
  fun pending(): List<LedgerEntry> = entries.filter { !it.synced && !it.localOnly }
}

sealed interface LedgerResult {
  data class Ok(val state: LedgerState, val entry: LedgerEntry) : LedgerResult
  data class Rejected(val why: String) : LedgerResult
}

object Ledger {
  const val MAX_ENTRIES = 300

  /** Adds an entry. Spending more than the balance is rejected; a burn is clamped to what is left. */
  fun append(state: LedgerState, entry: LedgerEntry): LedgerResult {
    if (entry.amount < 0) return LedgerResult.Rejected("negative amount")
    if (state.entries.any { it.id == entry.id }) return LedgerResult.Rejected("duplicate id")
    val bal = state.balance
    val fixed = when (entry.kind) {
      EntryKind.BURN -> entry.copy(amount = minOf(entry.amount, bal.coerceAtLeast(0)))
      EntryKind.SPEND, EntryKind.REDEEM ->
        if (entry.amount > bal) return LedgerResult.Rejected("not enough points") else entry
      else -> entry
    }
    // Zero is allowed for a burn (clamped at 0 points) and for a put-down, which is logged but pays nothing.
    if (fixed.amount == 0 && fixed.kind != EntryKind.BURN && fixed.kind != EntryKind.EARN) return LedgerResult.Rejected("zero amount")
    return LedgerResult.Ok(compact(state.copy(entries = state.entries + fixed)), fixed)
  }

  fun markSynced(state: LedgerState, ids: Collection<String>): LedgerState {
    if (ids.isEmpty()) return state
    val set = ids.toSet()
    return compact(state.copy(entries = state.entries.map { if (it.id in set) it.copy(synced = true) else it }))
  }

  fun compact(state: LedgerState, max: Int = MAX_ENTRIES): LedgerState {
    if (state.entries.size <= max) return state
    var excess = state.entries.size - max
    var archived = state.archivedBalance
    var local = state.localAdjust
    val kept = ArrayList<LedgerEntry>(state.entries.size)
    for (e in state.entries) {
      if (excess > 0 && (e.synced || e.localOnly)) {
        archived += e.delta
        if (e.localOnly) local += e.delta
        excess--
      } else kept += e
    }
    return LedgerState(kept, archived, local)
  }

  /**
   * The backend is the authority for points it knows about. After every pending entry was
   * accepted, make the local balance equal serverBalance plus our local-only deltas.
   */
  fun rebase(state: LedgerState, serverBalance: Int): LedgerState {
    if (state.pending().isNotEmpty()) return state
    val localInEntries = state.entries.filter { it.localOnly }.sumOf { it.delta }
    val target = serverBalance + state.localAdjust + localInEntries
    return state.copy(archivedBalance = target - state.entries.sumOf { it.delta })
  }
}

/** Mirrors backend/src/config.ts EARN_RULES so the optimistic local balance matches the server. */
object PointsRules {
  /** Putting the same app down again within this window isn't logged again (keeps badges honest). */
  const val REWARD_WINDOW_MS = 10 * 60_000L
  /** At least one minute between logged put-downs, even across different apps. */
  const val MIN_GAP_MS = 60_000L
  /** Put-downs are logged for at most this many different apps a day, so guarding 100 apps doesn't inflate badges. */
  const val MAX_RESISTED_APPS_PER_DAY = 8
  const val MINUTES_SAVED_PER_PUT_DOWN = 8
  const val MIN_BURN = 10
  const val MAX_BURN = 150
  const val BURN_FRACTION = 0.25
  const val COOLDOWN_MS = 10 * 60_000L

  const val HARD_MULTIPLIER = 2

  /** Points that "Continue anyway" would burn right now (doubled in hard mode, never more than the balance). */
  fun burnAmount(balance: Int, hard: Boolean = false): Int {
    if (balance <= 0) return 0
    val raw = (balance * BURN_FRACTION).roundToInt().coerceIn(MIN_BURN, MAX_BURN)
    return minOf(if (hard) raw * HARD_MULTIPLIER else raw, balance)
  }

  /** Bonus on the first win of a day: 10 + 5 per streak day, extra capped at 50 (server rule). */
  fun streakBonus(streak: Int): Int = 10 + minOf(5 * streak.coerceAtLeast(1), 50)
}
