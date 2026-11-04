package app.burn.focus.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionsTest {
  private val tiktok = "com.zhiliaoapp.musically"
  private val base = AppState(blockedApps = listOf(BlockedApp(tiktok, "TikTok")))

  @Test fun putDownIsLoggedButPaysNothing() {
    val o = Actions.putDown(base, tiktok, now = 0, today = 10, id = "a")
    assertEquals(0, o.points)
    assertEquals(0, o.state.points)
    assertEquals(1, o.state.stats.putDowns)
    assertEquals(PointsRules.MINUTES_SAVED_PER_PUT_DOWN, Actions.savedMinutesToday(o.state, 10))
    // The put-down still syncs (as a zero-point entry) so the server can count it for badges.
    assertEquals(1, o.state.ledger.pending().size)
    val o2 = Actions.putDown(o.state, tiktok, now = PointsRules.REWARD_WINDOW_MS, today = 10, id = "b")
    assertEquals(2, o2.state.stats.putDowns)
  }

  @Test fun putDownIsRateLimitedPerApp() {
    val o = Actions.putDown(base, tiktok, 0, 10, "a")
    val o2 = Actions.putDown(o.state, tiktok, 60_000, 10, "b")
    assertEquals(0, o2.points)
    assertEquals(1, o2.state.stats.putDowns)
  }

  @Test fun rapidDifferentAppsDoNotFarm() {
    val o = Actions.putDown(base, tiktok, 0, 10, "a")
    val o2 = Actions.putDown(o.state, "com.instagram.android", 10_000, 10, "b")
    assertEquals(0, o2.points)
    assertEquals(0, Actions.savedMinutesToday(o2.state, 10) - Actions.savedMinutesToday(o.state, 10))
  }

  @Test fun onlyEightDifferentAppsEarnPerDay() {
    val apps = (1..9).map { BlockedApp("pkg.app$it", "App $it") }
    var state = AppState(blockedApps = apps)
    var now = 0L
    repeat(8) { i ->
      state = Actions.putDown(state, "pkg.app${i + 1}", now, 10, "id$i").state
      now += PointsRules.REWARD_WINDOW_MS
    }
    val ninth = Actions.putDown(state, "pkg.app9", now, 10, "id9")
    assertEquals(0, ninth.points)
    assertEquals(8, ninth.state.stats.putDownAppsByDay[10]?.size)
  }

  @Test fun burnTakesPointsAndResetsStreak() {
    val rich = Actions.checkIn(base, 0, 10, "a").state
    val before = rich.points
    val o = Actions.burn(rich, tiktok, 1, 10, "b")
    assertEquals(PointsRules.burnAmount(before), o.points)
    assertEquals(before - o.points, o.state.points)
    assertEquals(0, o.state.streak.current)
    assertEquals(1, o.state.stats.burns)
  }

  @Test fun checkInOncePerDayAndNotAfterBurn() {
    val o = Actions.checkIn(base, 0, 10, "c")
    assertTrue(o.points > 0)
    assertEquals(0, Actions.checkIn(o.state, 1, 10, "d").points)
    val burned = Actions.burn(o.state, tiktok, 2, 11, "e").state
    assertEquals(0, Actions.checkIn(burned, 3, 11, "f").points)
  }

  @Test fun buyAndWearFurColors() {
    assertEquals(Cosmetics.DEFAULT_SKIN, base.equipped[Slot.SKIN.name]) // native look by default
    val rich = base.copy(ledger = LedgerState(archivedBalance = 100))
    val o = Actions.buy(rich, "skin_mint", 0, "x")
    assertTrue("skin_mint" in o.state.owned)
    assertEquals("skin_mint", o.state.equipped[Slot.SKIN.name])
    assertEquals(20, o.state.points)
    // wearing it again keeps it on; Classic is free and always wearable
    assertEquals("skin_mint", Actions.equip(o.state, "skin_mint").equipped[Slot.SKIN.name])
    val back = Actions.equip(o.state.copy(owned = o.state.owned - Cosmetics.DEFAULT_SKIN), Cosmetics.DEFAULT_SKIN)
    assertEquals(Cosmetics.DEFAULT_SKIN, back.equipped[Slot.SKIN.name])
    assertEquals(0, Actions.buy(base, "skin_gold", 0, "y").points) // can't afford
    assertEquals(null, Cosmetics.byId("hat_party")) // items are gone
    assertEquals(Cosmetics.DEFAULT_SKIN, Cosmetics.skinOf("skin_ember")) // retired ids fall back
  }

  @Test fun achievementsUnlock() {
    val s = Actions.putDown(base, tiktok, 0, 10, "a").state
    val a = Achievements.of(s, 10).associateBy { it.id }
    assertTrue(a.getValue("first-resist").unlocked)
    assertEquals(false, a.getValue("resist-10").unlocked)
  }

  @Test fun wireParsesOffersAndUrls() {
    val json = Wire.parse("""{"offers":[{"id":"off_1","business":"Bean","title":"Free coffee","description":"d","category":"cafe","discountPercent":100,"pointsPrice":150,"terms":"t","imageUrl":"/media/x.png"}]}""")
    val o = Wire.offers(json, "http://h:8787").single()
    assertEquals(150, o.pointsPrice); assertEquals("http://h:8787/media/x.png", o.imageUrl)
    assertEquals("https://x.ngrok.app", Wire.normalizeBaseUrl(" https://x.ngrok.app/api/ "))
    assertEquals("http://192.168.1.5:8787", Wire.normalizeBaseUrl("192.168.1.5:8787"))
    assertEquals(null, Wire.normalizeBaseUrl("  "))
  }
}
