package app.burn.focus.domain

/** Minimal copy of a UsageEvents.Event so the logic is testable on the JVM. */
data class FgEvent(val pkg: String, val type: Int, val at: Long) {
  companion object {
    /** UsageEvents.Event.ACTIVITY_RESUMED / MOVE_TO_FOREGROUND. */
    const val RESUMED = 1
    /** UsageEvents.Event.ACTIVITY_PAUSED / MOVE_TO_BACKGROUND. */
    const val PAUSED = 2
  }
}

/**
 * Tracks the newest foreground package from batches of usage events.
 * Empty batches keep the last known app (no events does not mean no app).
 */
class ForegroundTracker {
  var current: String? = null
    private set
  private var lastAt = Long.MIN_VALUE

  fun ingest(events: List<FgEvent>): String? {
    for (e in events.sortedBy { it.at }) {
      if (e.type != FgEvent.RESUMED || e.at < lastAt) continue
      current = e.pkg
      lastAt = e.at
    }
    return current
  }
}

sealed interface GateDecision {
  data object None : GateDecision
  data class Show(val pkg: String) : GateDecision
  /** The user left the blocked app while the overlay was up (e.g. pressed Home). */
  data class Hide(val pkg: String) : GateDecision
}

/**
 * Decides when to show/hide the overlay so it appears once per visit, never loops,
 * and respects the per-app cooldown after "Continue anyway" (re-prompts when it expires,
 * even if the user is still in the app).
 */
class InterceptGate(
  private val selfPkg: String,
  private val graceMs: Long = 2_000L,
  private val cooldownMs: Long = PointsRules.COOLDOWN_MS,
) {
  var overlayPkg: String? = null
    private set
  private val cooldownUntil = HashMap<String, Long>()
  private var suppressPkg: String? = null
  private var suppressUntil = 0L

  val showing: Boolean get() = overlayPkg != null

  fun cooldownRemaining(pkg: String, now: Long): Long = ((cooldownUntil[pkg] ?: 0L) - now).coerceAtLeast(0)

  fun onForeground(pkg: String?, now: Long, blocked: Set<String>, ignored: Set<String> = emptySet()): GateDecision {
    if (pkg == null || pkg == selfPkg) return GateDecision.None
    val showingPkg = overlayPkg
    if (showingPkg != null) {
      if (pkg == showingPkg) return GateDecision.None
      overlayPkg = null
      return GateDecision.Hide(showingPkg)
    }
    if (pkg !in blocked || pkg in ignored) return GateDecision.None
    if ((cooldownUntil[pkg] ?: 0L) > now) return GateDecision.None
    if (pkg == suppressPkg && now < suppressUntil) return GateDecision.None
    overlayPkg = pkg
    return GateDecision.Show(pkg)
  }

  /** Manual preview / forced show (debug). */
  fun forceShow(pkg: String) { overlayPkg = pkg }

  fun onPutDown(now: Long) {
    suppressPkg = overlayPkg
    suppressUntil = now + graceMs
    overlayPkg = null
  }

  fun onContinue(now: Long) {
    val p = overlayPkg ?: return
    cooldownUntil[p] = now + cooldownMs
    overlayPkg = null
  }

  fun dismissSilently() { overlayPkg = null }
}
