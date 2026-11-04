package app.burn.focus.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class NudgeCacheTest {
  private val tiktok = "com.zhiliaoapp.musically"

  @Test fun emptyCacheUsesBuiltinFallback() {
    val (n, _) = NudgeCache.pick(NudgeCacheState(), tiktok, "TikTok", BuiltinNudges.all, Random(1))
    assertTrue(n.id.startsWith("builtin-"))
  }

  @Test fun mergeDedupesAndCaps() {
    val fresh = List(80) { Nudge("n$it", "text $it") } + Nudge("dup", "TEXT 1 ")
    val s = NudgeCache.merge(NudgeCacheState(), fresh, now = 5)
    assertEquals(NudgeCache.MAX, s.nudges.size)
    assertEquals(s.nudges.size, s.nudges.map { it.text.trim().lowercase() }.toSet().size)
    assertEquals(5, s.fetchedAt)
  }

  @Test fun avoidsRecentRepeats() {
    var s = NudgeCacheState(nudges = List(8) { Nudge("n$it", "t$it") })
    val seen = ArrayList<String>()
    repeat(NudgeCache.RECENT + 1) {
      val (n, next) = NudgeCache.pick(s, tiktok, "TikTok", BuiltinNudges.all, Random(it))
      seen += n.id; s = next
    }
    assertEquals(NudgeCache.RECENT + 1, seen.toSet().size)
  }

  @Test fun otherAppNudgesAreNotUsed() {
    val s = NudgeCacheState(nudges = listOf(Nudge("ig", "insta only", app = "com.instagram.android")))
    repeat(10) {
      val (n, _) = NudgeCache.pick(s, tiktok, "TikTok", BuiltinNudges.all, Random(it))
      assertFalse(n.id == "ig")
    }
  }

  @Test fun appSpecificMatchesByPackageOrLabel() {
    val s = NudgeCacheState(nudges = listOf(Nudge("a", "for tiktok", app = "TikTok")))
    val (n, _) = NudgeCache.pick(s, tiktok, "TikTok", BuiltinNudges.all, Random(3))
    assertEquals("a", n.id)
  }

  @Test fun renderFillsPlaceholders() {
    val t = NudgeCache.render("{app}: {risk} of {points}, {streak}d, {goal}", NudgeContext("TikTok", 200, 50, 3, "read more"))
    assertEquals("TikTok: 50 of 200, 3d, read more", t)
  }

  @Test fun refreshWhenLowOrStale() {
    assertTrue(NudgeCache.needsRefresh(NudgeCacheState(), 0))
    val full = NudgeCacheState(nudges = List(20) { Nudge("$it", "t$it") }, fetchedAt = 1_000)
    assertFalse(NudgeCache.needsRefresh(full, 2_000))
    assertTrue(NudgeCache.needsRefresh(full, 1_000 + NudgeCache.STALE_MS + 1))
  }

  @Test fun serverBatchConvertsPointsPlaceholder() {
    val json = Wire.parse("""{"nudges":[{"id":7,"template":"Burn {points} on {app}?","tone":"witty"}]}""")
    val n = Wire.nudgeBatch(json, tiktok).single()
    assertEquals("srv-7", n.id); assertEquals("Burn {risk} on {app}?", n.text); assertEquals(tiktok, n.app)
  }
}
