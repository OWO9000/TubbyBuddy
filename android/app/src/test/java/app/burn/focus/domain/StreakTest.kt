package app.burn.focus.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class StreakTest {
  @Test fun consecutiveDaysGrow() {
    var s = Streak()
    s = StreakRules.onWin(s, 100); s = StreakRules.onWin(s, 100); s = StreakRules.onWin(s, 101); s = StreakRules.onWin(s, 102)
    assertEquals(3, s.current); assertEquals(3, s.best)
  }

  @Test fun gapRestartsAtOne() {
    var s = StreakRules.onWin(StreakRules.onWin(Streak(), 100), 101)
    s = StreakRules.onWin(s, 105)
    assertEquals(1, s.current); assertEquals(2, s.best)
  }

  @Test fun burnResetsAndSameDayWinRestarts() {
    var s = StreakRules.onWin(StreakRules.onWin(Streak(), 100), 101)
    s = StreakRules.onBurn(s, 101)
    assertEquals(0, s.current)
    s = StreakRules.onWin(s, 101)
    assertEquals(1, s.current); assertEquals(2, s.best)
  }

  @Test fun displayedLapsesAfterMissedDay() {
    val s = StreakRules.onWin(StreakRules.onWin(Streak(), 100), 101)
    assertEquals(2, StreakRules.displayed(s, 101))
    assertEquals(2, StreakRules.displayed(s, 102))
    assertEquals(0, StreakRules.displayed(s, 103))
  }
}
