package app.burn.focus.ui

import app.burn.focus.R
import app.burn.focus.domain.Cosmetics
import app.burn.focus.ui.companion.Mood
import app.burn.focus.ui.companion.tubbyFrame
import app.burn.focus.ui.companion.tubbyHasSkin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TubbyArtTest {
  @Test fun everyColorHasEveryMood() {
    for (c in Cosmetics.colors) {
      assertTrue(c.id, tubbyHasSkin(c.id))
      for (m in Mood.entries) assertNotEquals(0, tubbyFrame(c.id, m))
    }
  }

  @Test fun propsAreNotFurFrames() {
    assertEquals(6, Cosmetics.accessories.size)
    for (c in Cosmetics.accessories) assertTrue(c.id, !tubbyHasSkin(c.id))
  }

  @Test fun defaultIsTheNativeLookAndMoodsMap() {
    assertEquals(R.drawable.tubby_neutral, tubbyFrame(Cosmetics.DEFAULT_SKIN, Mood.CALM))
    assertEquals(R.drawable.tubby_angry, tubbyFrame(Cosmetics.DEFAULT_SKIN, Mood.SAD))
    assertEquals(R.drawable.tubby_mint_proud, tubbyFrame("skin_mint", Mood.CELEBRATE))
    assertEquals(R.drawable.tubby_surprised, tubbyFrame("skin_unknown", Mood.SURPRISED)) // unknown -> classic
  }
}
