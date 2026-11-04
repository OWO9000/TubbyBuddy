package app.burn.focus.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.burn.focus.BuildConfig
import app.burn.focus.domain.Actions
import app.burn.focus.domain.AppCategory
import app.burn.focus.domain.AppState
import app.burn.focus.domain.BlockedApp
import app.burn.focus.domain.BuiltinNudges
import app.burn.focus.domain.ChatMessage
import app.burn.focus.domain.ChatReply
import app.burn.focus.domain.CoachSettings
import app.burn.focus.domain.Cosmetics
import app.burn.focus.domain.EntryKind
import app.burn.focus.domain.Ledger
import app.burn.focus.domain.LedgerEntry
import app.burn.focus.domain.LedgerResult
import app.burn.focus.domain.MockOffers
import app.burn.focus.domain.Nudge
import app.burn.focus.domain.NudgeCache
import app.burn.focus.domain.NudgeContext
import app.burn.focus.domain.Offer
import app.burn.focus.domain.Outcome
import app.burn.focus.domain.PointsRules
import app.burn.focus.domain.Redemption
import app.burn.focus.domain.LedgerState
import app.burn.focus.domain.Streak
import app.burn.focus.domain.StreakRules
import app.burn.focus.domain.Wire
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

private val Context.burnStore: DataStore<Preferences> by preferencesDataStore(name = "burn_state")
private val STATE_KEY = stringPreferencesKey("state_v1")
private val LOCAL_DEV_URLS = setOf("http://10.0.2.2:8787", "http://localhost:8787", "http://127.0.0.1:8787")

data class OffersState(val offers: List<Offer> = MockOffers.all, val live: Boolean = false, val error: String? = null, val loading: Boolean = false)

sealed interface RedeemResult {
  data class Ok(val redemption: Redemption) : RedeemResult
  data class Failed(val message: String) : RedeemResult
}

/** Single source of truth for local state (DataStore, one JSON document) + backend sync. */
class BurnRepository(context: Context, private val scope: CoroutineScope) {
  private val store = context.applicationContext.burnStore
  private val syncLock = Mutex()

  val state: StateFlow<AppState?> = store.data
    .map { decode(it[STATE_KEY]) }
    .stateIn(scope, SharingStarted.Eagerly, null)

  private val _offers = MutableStateFlow(OffersState())
  val offers: StateFlow<OffersState> = _offers.asStateFlow()

  private fun decode(raw: String?): AppState {
    val s = raw?.let { runCatching { Wire.json.decodeFromString(AppState.serializer(), it) }.getOrNull() } ?: AppState()
    return s.copy(
      deviceId = s.deviceId.ifBlank { "and-" + UUID.randomUUID().toString().replace("-", "").take(20) },
      // Older builds saved a local dev server (the emulator alias or localhost); move them to this build's default.
      backendUrl = s.backendUrl.takeUnless { it.isBlank() || it.trimEnd('/') in LOCAL_DEV_URLS } ?: BuildConfig.DEFAULT_BACKEND_URL,
    )
  }

  suspend fun current(): AppState = decode(store.data.first()[STATE_KEY])

  /** Atomic read-modify-write; returns whatever [f] returns alongside the new state. */
  suspend fun <T> transact(f: (AppState) -> Pair<AppState, T>): T {
    var out: T? = null
    store.edit { prefs ->
      val (next, value) = f(decode(prefs[STATE_KEY]))
      prefs[STATE_KEY] = Wire.json.encodeToString(AppState.serializer(), next)
      out = value
    }
    @Suppress("UNCHECKED_CAST")
    return out as T
  }

  suspend fun update(f: (AppState) -> AppState) { transact { f(it) to Unit } }

  private fun newId() = UUID.randomUUID().toString()
  fun today(): Long = LocalDate.now().toEpochDay()

  // ---- user actions -------------------------------------------------------------------------

  suspend fun putDown(pkg: String): Outcome =
    transact { s -> Actions.putDown(s, pkg, System.currentTimeMillis(), today(), newId()).let { it.state to it } }
      .also { syncSoon() }

  suspend fun burn(pkg: String): Outcome =
    transact { s -> Actions.burn(s, pkg, System.currentTimeMillis(), today(), newId()).let { it.state to it } }
      .also { syncSoon() }

  suspend fun checkIn(): Outcome =
    transact { s -> Actions.checkIn(s, System.currentTimeMillis(), today(), newId()).let { it.state to it } }
      .also { syncSoon() }

  suspend fun buyOrEquip(cosmeticId: String): Outcome =
    transact { s -> Actions.buy(s, cosmeticId, System.currentTimeMillis(), newId()).let { it.state to it } }

  suspend fun setGoals(goals: String) = update { it.copy(goals = goals.trim().take(300)) }
  suspend fun setBlocked(apps: List<BlockedApp>) = update { it.copy(blockedApps = apps.distinctBy { a -> a.pkg }) }
  suspend fun setOnboarded(done: Boolean) = update { it.copy(onboarded = done) }
  suspend fun setGuardEnabled(on: Boolean) = update { it.copy(guardEnabled = on) }

  /** Returns false when the URL is unusable. */
  suspend fun setBackendUrl(raw: String): Boolean {
    val url = Wire.normalizeBaseUrl(raw) ?: return false
    update { it.copy(backendUrl = url, lastSyncError = null) }
    return true
  }

  /** Picks and renders the next overlay nudge (offline-safe), remembering it to avoid repeats. */
  suspend fun nextNudge(pkg: String, labelOverride: String? = null): String = transact { s ->
    val label = labelOverride ?: s.labelFor(pkg)
    val (n, cache) = NudgeCache.pick(s.nudges, pkg, label, BuiltinNudges.all)
    val ctx = NudgeContext(label, s.points, PointsRules.burnAmount(s.points, s.hardMode), StreakRules.displayed(s.streak, today()), firstGoal(s.goals))
    s.copy(nudges = cache) to NudgeCache.render(n.text, ctx)
  }

  private fun firstGoal(goals: String) = goals.split('\n', ';', '.').map { it.trim() }.firstOrNull { it.isNotEmpty() }?.lowercase().orEmpty()

  // ---- backend ------------------------------------------------------------------------------

  private fun api(s: AppState) = Api(s.backendUrl, s.deviceId, s.sessionToken)

  // ---- account: Google sign-in runs in the browser; the app polls for its session ----------

  sealed interface LinkStart {
    data class Ready(val code: String, val url: String) : LinkStart
    data class Failed(val message: String) : LinkStart
  }

  suspend fun startSignIn(): LinkStart {
    val s = current()
    return when (val r = Api(s.backendUrl, s.deviceId).post("/api/auth/link", buildJsonObject { put("label", "the Android app") })) {
      is ApiResult.Ok -> {
        val o = r.body?.jsonObject
        val code = o?.get("code")?.jsonPrimitive?.contentOrNull
        val url = o?.get("url")?.jsonPrimitive?.contentOrNull
        if (code != null && url != null) LinkStart.Ready(code, url) else LinkStart.Failed("Unexpected reply from the server")
      }
      is ApiResult.Http -> LinkStart.Failed(if (r.code == 503) "This server doesn't have Google sign-in set up" else r.message)
      is ApiResult.Net -> LinkStart.Failed("Can't reach the server: ${r.message}")
    }
  }

  sealed interface SignInState {
    data object Idle : SignInState
    data object Waiting : SignInState
    data object Done : SignInState
    data class Failed(val message: String) : SignInState
  }

  private val _signIn = MutableStateFlow<SignInState>(SignInState.Idle)
  val signIn: StateFlow<SignInState> = _signIn.asStateFlow()

  /** Gets a link code and returns the browser URL to open; polling runs in the app scope so it survives navigation. */
  suspend fun beginSignIn(): String? {
    if (_signIn.value == SignInState.Waiting) return null
    return when (val r = startSignIn()) {
      is LinkStart.Failed -> { _signIn.value = SignInState.Failed(r.message); null }
      is LinkStart.Ready -> {
        _signIn.value = SignInState.Waiting
        scope.launch {
          val until = System.currentTimeMillis() + 10 * 60_000
          while (System.currentTimeMillis() < until) {
            kotlinx.coroutines.delay(2_000)
            when (runCatching { pollSignIn(r.code) }.getOrDefault("pending")) {
              "approved" -> { _signIn.value = SignInState.Done; return@launch }
              "expired" -> { _signIn.value = SignInState.Failed("The sign-in link expired. Try again."); return@launch }
            }
          }
          _signIn.value = SignInState.Failed("Sign-in timed out. Try again.")
        }
        r.url
      }
    }
  }

  fun clearSignInState() { if (_signIn.value != SignInState.Waiting) _signIn.value = SignInState.Idle }

  /** "pending", "approved" or "expired". On approval the phone switches to the account's profile and syncs. */
  suspend fun pollSignIn(code: String): String {
    val s = current()
    val r = Api(s.backendUrl, s.deviceId).get("/api/auth/link/$code") as? ApiResult.Ok ?: return "pending"
    val o = r.body?.jsonObject ?: return "pending"
    val status = o["status"]?.jsonPrimitive?.contentOrNull ?: "pending"
    if (status != "approved") return status
    val token = o["token"]?.jsonPrimitive?.contentOrNull ?: return "expired"
    val acct = o["account"]?.jsonObject ?: return "expired"
    val profile = acct["profileId"]?.jsonPrimitive?.contentOrNull ?: return "expired"
    update {
      it.copy(
        sessionToken = token,
        deviceId = profile,
        accountName = acct["name"]?.jsonPrimitive?.contentOrNull,
        accountEmail = acct["email"]?.jsonPrimitive?.contentOrNull,
        accountPicture = acct["picture"]?.jsonPrimitive?.contentOrNull,
        accountOnboarded = acct["onboarded"]?.jsonPrimitive?.contentOrNull == "true",
        ledger = LedgerState(),
        redemptions = emptyList(),
        chat = emptyList(),
        greeting = null,
        lastSyncError = null,
      )
    }
    runCatching { sync() }
    return "approved"
  }

  /** Ends this phone's session and starts a fresh guest profile. Guarded apps and permissions stay. */
  suspend fun signOut() {
    val s = current()
    if (s.signedIn) runCatching { api(s).post("/api/auth/logout", buildJsonObject { }) }
    update {
      it.copy(
        sessionToken = null,
        accountName = null,
        accountEmail = null,
        accountPicture = null,
        accountOnboarded = false,
        deviceId = "and-" + UUID.randomUUID().toString().replace("-", "").take(20),
        ledger = LedgerState(),
        redemptions = emptyList(),
        chat = emptyList(),
        greeting = null,
        streak = Streak(),
        lastSyncError = null,
      )
    }
  }

  /** Writes the decoded state once so the generated profile id is stable from the first launch. */
  suspend fun ensureSaved() = update { it }

  /** Switch to a fresh demo profile with two weeks of history (made by the server), as a guest. */
  suspend fun useDemoProfile() {
    val s = current()
    val r = Api(s.backendUrl, s.deviceId).post("/api/demo/profile", buildJsonObject { put("from", s.deviceId) })
    val id = ((r as? ApiResult.Ok)?.body?.jsonObject?.get("deviceId"))?.jsonPrimitive?.contentOrNull
      ?: throw IllegalStateException(if (r is ApiResult.Net) "Can't reach the server" else "Couldn't open the demo account")
    update {
      it.copy(
        deviceId = id, sessionToken = null, accountName = null, accountEmail = null, accountPicture = null, accountOnboarded = false,
        ledger = LedgerState(), redemptions = emptyList(), chat = emptyList(), greeting = null, streak = Streak(), lastSyncError = null,
      )
    }
    runCatching { sync() }
  }

  /**
   * The setup chat and Settings speak in app names ("TikTok", "YouTube"). Match them to packages: well-known ids
   * first (kept even if the app isn't installed yet), then installed apps by label. Apps picked by hand in the
   * phone guard stay when their name is still on the list.
   */
  suspend fun applySetupNames(names: List<String>, installed: List<LaunchableApp>) {
    val wanted = names.map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { it.lowercase() }
    val out = LinkedHashMap<String, BlockedApp>()
    for (name in wanted) {
      val key = name.lowercase()
      KnownApps.packagesFor(key).forEach { pkg ->
        val hit = installed.firstOrNull { it.pkg == pkg }
        out[pkg] = BlockedApp(pkg, hit?.label ?: name, (hit?.category ?: AppCategory.SOCIAL).id)
      }
      installed.filter { it.label.equals(name, true) || (key.length > 3 && it.label.lowercase().contains(key)) }
        .forEach { out[it.pkg] = BlockedApp(it.pkg, it.label, it.category.id) }
    }
    update { s ->
      val keep = s.blockedApps.filter { b -> wanted.any { it.equals(b.label, true) } }
      s.copy(blockedApps = (keep + out.values).distinctBy { it.pkg }, onboarded = true, guardEnabled = true)
    }
  }

  /** Hand-picked apps go back to the shared list (names, max 12) so web and PC see the same guarded apps. */
  suspend fun pushGuardedNames() {
    val s = current()
    val names = s.blockedApps.map { it.label.take(40) }.distinctBy { it.lowercase() }.take(12)
    val body = buildJsonObject { put("apps", kotlinx.serialization.json.JsonArray(names.map { kotlinx.serialization.json.JsonPrimitive(it) })) }
    runCatching { api(s).put("/api/assistant/settings", body) }
  }

  fun syncSoon() { scope.launch { runCatching { sync() } } }

  data class SyncReport(val ok: Boolean, val pushed: Int, val message: String)

  /** Push pending ledger entries, rebase onto the server balance, refresh nudges if stale. */
  suspend fun sync(refreshNudges: Boolean = true): SyncReport = syncLock.withLock {
    val s = current()
    val api = api(s)
    val done = ArrayList<String>()
    var netError: String? = null
    var lastBalance: Int? = null
    for (e in s.ledger.pending()) {
      val r = push(api, s, e)
      when (r) {
        is ApiResult.Ok -> { done += e.id; Wire.me(r.body)?.let { lastBalance = it.balance } }
        // 409 = server already counted today's streak; other 4xx will never succeed: drop them.
        is ApiResult.Http -> if (r.code in 400..499) done += e.id else { netError = r.message; break }
        is ApiResult.Net -> { netError = r.message; break }
      }
    }
    val me = if (netError == null) api.get("/api/me") else null
    val snapshot = (me as? ApiResult.Ok)?.let { Wire.me(it.body) }
    if (me is ApiResult.Net) netError = me.message
    if (me is ApiResult.Http) netError = me.message
    val balance = snapshot?.balance ?: lastBalance.takeIf { netError == null }
    update { st ->
      var l = Ledger.markSynced(st.ledger, done)
      if (balance != null) l = Ledger.rebase(l, balance)
      val owned = if (snapshot != null) st.owned + snapshot.owned else st.owned
      val equipped = if (snapshot != null) snapshot.equipped else st.equipped
      st.copy(
        ledger = l,
        owned = owned,
        equipped = equipped,
        serverAchievements = snapshot?.achievements ?: st.serverAchievements,
        hardMode = snapshot?.hardMode ?: st.hardMode,
        lastSyncAt = if (netError == null) System.currentTimeMillis() else st.lastSyncAt,
        lastSyncError = netError,
      )
    }
    if (netError == null && refreshNudges) refreshNudgesIfStale()
    SyncReport(netError == null, done.size, netError ?: "Synced ${done.size} change(s)")
  }

  private suspend fun push(api: Api, s: AppState, e: LedgerEntry): ApiResult = when (e.kind) {
    EntryKind.EARN -> api.post("/api/points/earn", buildJsonObject {
      put("deviceId", s.deviceId); put("event", "resisted_temptation")
      e.app?.let { put("appName", s.labelFor(it).take(60)) }
    })
    EntryKind.BONUS -> api.post("/api/points/earn", buildJsonObject {
      put("deviceId", s.deviceId); put("event", "streak_day")
      put("day", Instant.ofEpochMilli(e.at).atZone(ZoneId.systemDefault()).toLocalDate().toString())
    })
    EntryKind.BURN ->
      if (e.amount <= 0) ApiResult.Ok(200, null)
      else api.post("/api/points/burn", buildJsonObject {
        put("deviceId", s.deviceId); put("reason", e.reason.take(200)); put("amount", e.amount)
        put("breaksStreak", true)
        // The amount already includes the hard-mode multiplier; tell the server not to apply it twice.
        put("difficultyApplied", true)
        e.app?.let { put("appName", s.labelFor(it).take(60)) }
      })
    EntryKind.SPEND, EntryKind.REDEEM -> ApiResult.Ok(200, null)
  }

  suspend fun refreshNudgesIfStale(force: Boolean = false) {
    val s = current()
    if (!force && !NudgeCache.needsRefresh(s.nudges, System.currentTimeMillis())) return
    if (s.blockedApps.isEmpty()) return
    val api = api(s)
    val fresh = ArrayList<Nudge>()
    for (app in s.blockedApps.take(3)) {
      val r = api.post("/api/nudges/batch", buildJsonObject {
        put("deviceId", s.deviceId)
        put("goals", s.goals.ifBlank { "spend less time scrolling and more time living" }.take(300).padEnd(2, '.'))
        put("appName", app.label.take(60))
        put("pointsAtRisk", PointsRules.burnAmount(s.points, s.hardMode))
        put("streak", StreakRules.displayed(s.streak, today()))
        put("count", 8)
      }, readTimeoutMs = 45_000)
      if (r is ApiResult.Ok) fresh += Wire.nudgeBatch(r.body, app.pkg) else break
    }
    if (fresh.isNotEmpty()) update { it.copy(nudges = NudgeCache.merge(it.nudges, fresh, System.currentTimeMillis())) }
  }

  suspend fun testConnection(): String {
    val s = current()
    return when (val r = api(s).get("/api/me")) {
      is ApiResult.Ok -> Wire.me(r.body)?.let { "Connected. Server balance ${it.balance} pts." } ?: "Connected (unexpected reply)"
      is ApiResult.Http -> "Server answered ${r.code}: ${r.message}"
      is ApiResult.Net -> "Can't reach ${s.backendUrl}: ${r.message}"
    }
  }

  /** Demo helper: asks the backend for a 500-point grant; offline it adds a local-only grant. */
  suspend fun demoGrant(): String {
    val s = current()
    val r = api(s).post("/api/points/earn", buildJsonObject {
      put("deviceId", s.deviceId); put("event", "demo_grant"); put("amount", JsonPrimitive(500))
    })
    return if (r is ApiResult.Ok) {
      sync(refreshNudges = false); "Server granted 500 demo points"
    } else {
      transact { st ->
        val e = LedgerEntry(newId(), EntryKind.BONUS, 500, "Demo points (offline)", System.currentTimeMillis(), localOnly = true)
        when (val res = Ledger.append(st.ledger, e)) {
          is LedgerResult.Ok -> st.copy(ledger = res.state) to Unit
          is LedgerResult.Rejected -> st to Unit
        }
      }
      "Backend unreachable, added 500 local demo points"
    }
  }

  suspend fun refreshOffers() {
    _offers.value = _offers.value.copy(loading = true)
    val s = current()
    _offers.value = when (val r = api(s).get("/api/offers")) {
      is ApiResult.Ok -> {
        val list = Wire.offers(r.body, s.backendUrl)
        if (list.isEmpty()) OffersState(MockOffers.all, live = false, error = "No live offers yet, showing samples")
        else OffersState(list, live = true)
      }
      is ApiResult.Http -> OffersState(MockOffers.all, false, "Offers unavailable (${r.code}), showing samples")
      is ApiResult.Net -> OffersState(MockOffers.all, false, "Offline, showing sample offers")
    }
  }

  suspend fun redeem(offer: Offer): RedeemResult {
    val s = current()
    if (s.points < offer.pointsPrice) return RedeemResult.Failed("You need ${offer.pointsPrice - s.points} more points")
    if (!offer.id.startsWith("mock-")) {
      // Make sure the server has our latest points before it checks the balance.
      sync(refreshNudges = false)
      when (val r = api(s).post("/api/offers/${offer.id}/redeem", buildJsonObject { put("deviceId", s.deviceId) })) {
        is ApiResult.Ok -> {
          val (red, balance) = Wire.redemption(r.body, offer, System.currentTimeMillis())
            ?: return RedeemResult.Failed("Unexpected reply from server")
          update { st ->
            val o = Actions.redeem(st, red, newId())
            val l = if (balance != null) Ledger.rebase(o.state.ledger, balance) else o.state.ledger
            o.state.copy(ledger = l)
          }
          return RedeemResult.Ok(red)
        }
        is ApiResult.Http -> return RedeemResult.Failed(r.message)
        is ApiResult.Net -> Unit // fall through to an offline demo code
      }
    }
    val code = "BURN-DEMO-" + UUID.randomUUID().toString().take(6).uppercase()
    val red = Redemption(newId(), offer.id, offer.title, offer.business, code, offer.pointsPrice, System.currentTimeMillis(), offline = true)
    val ok = transact { st ->
      val o = Actions.redeem(st, red, newId())
      o.state to (o.message == null)
    }
    return if (ok) RedeemResult.Ok(red) else RedeemResult.Failed("Not enough points")
  }

  // ---- cosmetics (server catalog + local fallback) ------------------------------------------

  suspend fun buyCosmetic(localId: String): Outcome {
    val s = current()
    val c = Cosmetics.byId(localId) ?: return Outcome(s, 0, message = "Unknown item")
    val slot = Cosmetics.slotFor(localId).api
    val serverId = Cosmetics.serverId(localId)
    when (val r = api(s).post("/api/store/buy", buildJsonObject {
      put("deviceId", s.deviceId); put("cosmeticId", serverId)
    }, readTimeoutMs = 15_000)) {
      is ApiResult.Ok -> {
        equipOnServer(s, localId)
        sync(refreshNudges = false)
        return Outcome(current(), c.price, message = "Bought ${c.name}")
      }
      is ApiResult.Http -> if (r.code != 409) return Outcome(s, 0, message = r.message)
      is ApiResult.Net -> {
        val local = transact { st -> Actions.buy(st, localId, System.currentTimeMillis(), newId()).let { it.state to it } }
        return local.copy(message = local.message?.plus(" (offline)"))
      }
    }
    return Outcome(s, 0, message = "Already owned")
  }

  suspend fun equipCosmetic(localId: String): Outcome {
    val s = current()
    val c = Cosmetics.byId(localId) ?: return Outcome(s, 0, message = "Unknown item")
    return when (val r = equipOnServer(s, localId)) {
      is ApiResult.Ok -> {
        sync(refreshNudges = false)
        Outcome(current(), 0, message = "Wearing ${c.name}")
      }
      is ApiResult.Net -> transact { st -> Actions.equip(st, localId) to Outcome(st, 0, message = "Wearing ${c.name} (offline)") }
      is ApiResult.Http -> Outcome(s, 0, message = r.message)
    }
  }

  private suspend fun equipOnServer(s: AppState, localId: String): ApiResult {
    val serverId = Cosmetics.serverId(localId)
    val slot = Cosmetics.slotFor(localId).api
    val idValue = if (localId == Cosmetics.DEFAULT_SKIN) JsonNull else JsonPrimitive(serverId)
    return api(s).post("/api/store/equip", buildJsonObject {
      put("deviceId", s.deviceId); put("slot", slot); put("cosmeticId", idValue)
    }, readTimeoutMs = 15_000)
  }

  // ---- focus --------------------------------------------------------------------------------

  suspend fun completeFocus(minutes: Int): Outcome {
    val s = current()
    val body = buildJsonObject {
      put("deviceId", s.deviceId); put("event", "focus_session"); put("minutes", minutes)
    }
    return when (val r = api(s).post("/api/points/earn", body, readTimeoutMs = 15_000)) {
      is ApiResult.Ok -> {
        sync(refreshNudges = false)
        Outcome(current(), 20, message = "+20 points for $minutes minutes")
      }
      is ApiResult.Http -> Outcome(s, 0, message = r.message)
      is ApiResult.Net -> transact { st ->
        val o = Actions.focus(st, minutes, System.currentTimeMillis(), newId())
        o.state to o.copy(message = o.message?.plus(" (offline)"))
      }
    }
  }

  // ---- coach + chat -------------------------------------------------------------------------
  data class CoachState(val settings: CoachSettings, val live: Boolean, val model: String)

  suspend fun refreshCoach(): CoachState? {
    val s = current()
    val r = api(s).get("/api/assistant/settings")
    if (r !is ApiResult.Ok) return null
    val body = r.body as? kotlinx.serialization.json.JsonObject ?: return null
    val coach = Wire.coachSettings(body) ?: return null
    val live = (body["assistantMode"] as? JsonPrimitive)?.content == "live"
    val model = (body["model"] as? JsonPrimitive)?.content ?: ""
    update { it.copy(coach = coach) }
    return CoachState(coach, live, model)
  }

  suspend fun saveCoach(coach: CoachSettings): Outcome {
    val s = current()
    val goals = s.goals.split('\n', ';').map { it.trim() }.filter { it.length > 1 }.take(6)
    val apps = s.blockedApps.map { it.label }.take(12)
    val body = buildJsonObject {
      put("tone", coach.tone); put("brevity", coach.brevity); put("nudges", coach.nudges)
      put("goals", buildJsonArray { goals.forEach { add(JsonPrimitive(it)) } })
      put("apps", buildJsonArray { apps.forEach { add(JsonPrimitive(it)) } })
    }
    return when (val r = api(s).put("/api/assistant/settings", body)) {
      is ApiResult.Ok -> {
        update { it.copy(coach = coach) }
        Outcome(current(), 0, message = "Coach saved")
      }
      is ApiResult.Http -> {
        update { it.copy(coach = coach) } // keep it locally too
        Outcome(current(), 0, message = "Saved locally: ${r.message}")
      }
      is ApiResult.Net -> {
        update { it.copy(coach = coach) }
        Outcome(current(), 0, message = "Saved offline")
      }
    }
  }

  suspend fun refreshGreeting(force: Boolean = false): String? {
    val s = current()
    if (!force && s.greeting != null && System.currentTimeMillis() - s.greetedAt < 2 * 3_600_000) return s.greeting
    val r = api(s).post("/api/assistant/hello", buildJsonObject { }, readTimeoutMs = 20_000)
    val text = if (r is ApiResult.Ok) Wire.hello(r.body) else null
    val fallback = localGreeting(s)
    val message = text ?: fallback
    update { it.copy(greeting = message, greetedAt = System.currentTimeMillis(), lastLine = message) }
    return message
  }

  suspend fun sendChat(text: String): ChatReply {
    val s = current()
    val user = ChatMessage("user", text.trim().take(1000), System.currentTimeMillis())
    update { it.copy(chat = (it.chat + user).takeLast(40)) }
    val history = (s.chat + user).takeLast(12).map { buildJsonObject { put("role", it.role); put("content", it.content) } }
    val body = buildJsonObject { put("messages", buildJsonArray { history.forEach { add(it) } }) }
    val r = api(s).post("/api/assistant/chat", body, readTimeoutMs = 60_000)
    val reply = (r as? ApiResult.Ok)?.let { Wire.chatReply(it.body) }
    val final = reply ?: ChatReply(localReply(text, s), "worried", "offline")
    val msg = ChatMessage("assistant", final.text, System.currentTimeMillis())
    update { it.copy(chat = (it.chat + msg).takeLast(40), lastLine = final.text) }
    return final
  }

  suspend fun clearChat() = update { it.copy(chat = emptyList()) }

  suspend fun addAssistantMessage(text: String) {
    if (text.isBlank()) return
    update { it.copy(chat = (it.chat + ChatMessage("assistant", text, System.currentTimeMillis())).takeLast(40), lastLine = text) }
  }

  suspend fun setVoiceReplies(on: Boolean) = update { it.copy(coach = it.coach.copy(voice = on)) }

  private fun localGreeting(s: AppState): String {
    val streak = StreakRules.displayed(s.streak, today())
    return when {
      streak >= 3 -> "${streak} days strong. Same again today?"
      s.points > 0 -> "${s.points} points in the bank. What's next?"
      s.goals.isNotBlank() -> "What's the one thing today? ${s.goals.take(60)}"
      else -> "I'm here. What's pulling at you?"
    }
  }

  private fun localReply(text: String, s: AppState): String {
    val t = text.lowercase()
    val goal = s.goals.split('\n', ';').firstOrNull { it.isNotBlank() }?.trim()?.lowercase()
    return when {
      listOf("scroll", "tiktok", "instagram", "urge", "crave", "bored").any { it in t } ->
        if (s.points > 0) "Close it. ${s.points} points are yours if you put it down for two minutes."
        else "Close it for two minutes. No points to lose yet, but the streak starts today."
      listOf("finished", "done", "put it down", "resisted", "checked in").any { it in t } ->
        "That's a real win. ${s.points} points banked. What's next?"
      "why" in t && goal != null -> "Because $goal needs the minutes the feed takes. Just this next choice."
      goal != null -> "One tiny step: two minutes of $goal. Then decide."
      else -> "I'm here. What's pulling at you right now?"
    }
  }
}
