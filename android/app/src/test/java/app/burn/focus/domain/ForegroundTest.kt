package app.burn.focus.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForegroundTest {
  private val self = "app.burn.focus"
  private val tiktok = "com.zhiliaoapp.musically"
  private val launcher = "com.android.launcher3"
  private val blocked = setOf(tiktok)
  private fun res(p: String, t: Long) = FgEvent(p, FgEvent.RESUMED, t)

  @Test fun trackerKeepsLastKnownOnEmptyBatches() {
    val t = ForegroundTracker()
    assertNull(t.ingest(emptyList()))
    assertEquals(tiktok, t.ingest(listOf(res(launcher, 1), res(tiktok, 2))))
    assertEquals(tiktok, t.ingest(emptyList()))
  }

  @Test fun trackerUsesNewestResumeAndIgnoresStaleOrPaused() {
    val t = ForegroundTracker()
    t.ingest(listOf(res(tiktok, 10), FgEvent(tiktok, FgEvent.PAUSED, 11), res(launcher, 12)))
    assertEquals(launcher, t.current)
    t.ingest(listOf(res(tiktok, 5))) // late, older event from an overlapping window
    assertEquals(launcher, t.current)
  }

  @Test fun showsOnceAndDoesNotLoopWhileShowing() {
    val g = InterceptGate(self)
    assertEquals(GateDecision.Show(tiktok), g.onForeground(tiktok, 0, blocked))
    repeat(20) { assertEquals(GateDecision.None, g.onForeground(tiktok, 700L * it, blocked)) }
  }

  @Test fun nonBlockedAndSelfIgnored() {
    val g = InterceptGate(self)
    assertEquals(GateDecision.None, g.onForeground(launcher, 0, blocked))
    assertEquals(GateDecision.None, g.onForeground(self, 0, blocked))
    assertEquals(GateDecision.None, g.onForeground(null, 0, blocked))
  }

  @Test fun leavingWhileShowingHides() {
    val g = InterceptGate(self)
    g.onForeground(tiktok, 0, blocked)
    assertEquals(GateDecision.Hide(tiktok), g.onForeground(launcher, 800, blocked))
    assertEquals(false, g.showing)
  }

  @Test fun putDownSuppressesStaleEventsThenReArms() {
    val g = InterceptGate(self, graceMs = 2_000)
    g.onForeground(tiktok, 0, blocked)
    g.onPutDown(1_000)
    assertEquals(GateDecision.None, g.onForeground(tiktok, 1_700, blocked)) // lagging event, no flicker
    assertEquals(GateDecision.None, g.onForeground(launcher, 2_000, blocked))
    assertEquals(GateDecision.Show(tiktok), g.onForeground(tiktok, 3_500, blocked))
  }

  @Test fun continueAnywayCoolsDownThenReprompts() {
    val g = InterceptGate(self, cooldownMs = 300_000)
    g.onForeground(tiktok, 0, blocked)
    g.onContinue(1_000)
    assertEquals(GateDecision.None, g.onForeground(tiktok, 2_000, blocked))
    assertEquals(GateDecision.None, g.onForeground(launcher, 60_000, blocked))
    assertEquals(GateDecision.None, g.onForeground(tiktok, 120_000, blocked))
    assertEquals(GateDecision.Show(tiktok), g.onForeground(tiktok, 301_001, blocked))
  }
}
