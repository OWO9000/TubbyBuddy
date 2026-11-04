package app.burn.focus.ui.companion

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.imageResource
import app.burn.focus.R
import app.burn.focus.domain.Cosmetics
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/**
 * Pre-rendered Tubby frames: one per fur color x mood, exported from the 3D model with the fur recolored in the
 * texture (so shading and outlines stay clean). Moods are body language plus an effect glyph.
 */
private val FRAMES: Map<String, Map<Mood, Int>> = mapOf(
  "skin_classic" to mapOf(Mood.CALM to R.drawable.tubby_neutral, Mood.HAPPY to R.drawable.tubby_happy, Mood.CELEBRATE to R.drawable.tubby_proud, Mood.WORRIED to R.drawable.tubby_worried, Mood.SAD to R.drawable.tubby_angry, Mood.SURPRISED to R.drawable.tubby_surprised),
  "skin_mint" to mapOf(Mood.CALM to R.drawable.tubby_mint_neutral, Mood.HAPPY to R.drawable.tubby_mint_happy, Mood.CELEBRATE to R.drawable.tubby_mint_proud, Mood.WORRIED to R.drawable.tubby_mint_worried, Mood.SAD to R.drawable.tubby_mint_angry, Mood.SURPRISED to R.drawable.tubby_mint_surprised),
  "skin_ocean" to mapOf(Mood.CALM to R.drawable.tubby_ocean_neutral, Mood.HAPPY to R.drawable.tubby_ocean_happy, Mood.CELEBRATE to R.drawable.tubby_ocean_proud, Mood.WORRIED to R.drawable.tubby_ocean_worried, Mood.SAD to R.drawable.tubby_ocean_angry, Mood.SURPRISED to R.drawable.tubby_ocean_surprised),
  "skin_grape" to mapOf(Mood.CALM to R.drawable.tubby_grape_neutral, Mood.HAPPY to R.drawable.tubby_grape_happy, Mood.CELEBRATE to R.drawable.tubby_grape_proud, Mood.WORRIED to R.drawable.tubby_grape_worried, Mood.SAD to R.drawable.tubby_grape_angry, Mood.SURPRISED to R.drawable.tubby_grape_surprised),
  "skin_sunset" to mapOf(Mood.CALM to R.drawable.tubby_sunset_neutral, Mood.HAPPY to R.drawable.tubby_sunset_happy, Mood.CELEBRATE to R.drawable.tubby_sunset_proud, Mood.WORRIED to R.drawable.tubby_sunset_worried, Mood.SAD to R.drawable.tubby_sunset_angry, Mood.SURPRISED to R.drawable.tubby_sunset_surprised),
  "skin_midnight" to mapOf(Mood.CALM to R.drawable.tubby_midnight_neutral, Mood.HAPPY to R.drawable.tubby_midnight_happy, Mood.CELEBRATE to R.drawable.tubby_midnight_proud, Mood.WORRIED to R.drawable.tubby_midnight_worried, Mood.SAD to R.drawable.tubby_midnight_angry, Mood.SURPRISED to R.drawable.tubby_midnight_surprised),
  "skin_gold" to mapOf(Mood.CALM to R.drawable.tubby_gold_neutral, Mood.HAPPY to R.drawable.tubby_gold_happy, Mood.CELEBRATE to R.drawable.tubby_gold_proud, Mood.WORRIED to R.drawable.tubby_gold_worried, Mood.SAD to R.drawable.tubby_gold_angry, Mood.SURPRISED to R.drawable.tubby_gold_surprised),
)

@DrawableRes
internal fun tubbyFrame(skin: String, mood: Mood): Int {
  val set = FRAMES[skin] ?: FRAMES.getValue(Cosmetics.DEFAULT_SKIN)
  return set[mood] ?: set.getValue(Mood.CALM)
}

/** Skins that have a full frame set (every catalog color should). */
internal fun tubbyHasSkin(skin: String): Boolean = skin in FRAMES

/** Default renderer: Tubby, a 3D cat, as pre-rendered mood frames with idle motion. */
object TubbyArt : CompanionArt {
  @Composable
  override fun Render(spec: CompanionSpec, modifier: Modifier) {
    val inf = rememberInfiniteTransition(label = "tubby")
    val phase by inf.animateFloat(
      0f, (2 * PI).toFloat(),
      infiniteRepeatable(tween(3200, easing = LinearEasing), RepeatMode.Restart), label = "phase",
    )
    val bitmap = ImageBitmap.imageResource(tubbyFrame(spec.skin, spec.mood))
    val breathe = sin(phase)
    val hop = when (spec.mood) {
      Mood.CELEBRATE -> -abs(sin(phase * 2f)) * 0.05f
      Mood.HAPPY -> -abs(sin(phase)) * 0.02f
      else -> 0f
    }
    val shake = if (spec.mood == Mood.WORRIED) sin(phase * 9f) * 0.006f else 0f

    Box(modifier) {
      Canvas(Modifier.fillMaxSize()) {
        // soft ground shadow
        val s = minOf(size.width, size.height)
        val w = s * 0.42f * (1f + hop * 3f)
        drawOval(Color.Black.copy(alpha = 0.18f), Offset(size.width / 2f - w / 2f, size.height / 2f + s * 0.44f), Size(w, s * 0.05f))
      }
      Box(
        Modifier.fillMaxSize().graphicsLayer {
          val s = minOf(size.width, size.height)
          translationY = hop * s
          translationX = shake * s
          scaleX = 1f + 0.012f * breathe
          scaleY = 1f - 0.012f * breathe
          rotationZ = sin(phase * 0.5f) * 1.5f
          transformOrigin = TransformOrigin(0.5f, 0.95f)
        },
      ) {
        Image(
          bitmap = bitmap,
          contentDescription = null,
          contentScale = ContentScale.Fit,
          modifier = Modifier.fillMaxSize(),
        )
        AccessoryOverlay(spec.accessory, Modifier.fillMaxSize())
      }
    }
  }
}

/** Frozen thumbnail of Tubby (store cards). */
@Composable
internal fun TubbyStatic(spec: CompanionSpec, modifier: Modifier) {
  Box(modifier) {
    Image(
      bitmap = ImageBitmap.imageResource(tubbyFrame(spec.skin, spec.mood)),
      contentDescription = null,
      contentScale = ContentScale.Fit,
      modifier = Modifier.fillMaxSize(),
    )
    AccessoryOverlay(spec.accessory, Modifier.fillMaxSize())
  }
}
