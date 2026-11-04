package app.burn.focus.ui.companion

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import app.burn.focus.domain.AppState
import app.burn.focus.domain.Cosmetics
import app.burn.focus.domain.Slot
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

enum class Mood { CALM, HAPPY, CELEBRATE, WORRIED, SAD, SURPRISED }

/** Everything a renderer needs. Generated art can implement [CompanionArt] with the same spec. */
data class CompanionSpec(
  val mood: Mood = Mood.CALM,
  val skin: String = Cosmetics.DEFAULT_SKIN,
  val accessory: String? = null,
) {
  companion object {
    fun from(s: AppState, mood: Mood) = CompanionSpec(
      mood = mood,
      skin = Cosmetics.skinOf(s.equipped[Slot.SKIN.name]),
      accessory = s.accessory,
    )
  }
}

/** Swap point for future art (e.g. Muse Image sprites): provide another implementation via [LocalCompanionArt]. */
interface CompanionArt {
  @Composable
  fun Render(spec: CompanionSpec, modifier: Modifier)
}

/** Tubby (pre-rendered 3D frames) is the default; [BlobArt] stays as a pure-Canvas fallback. */
val LocalCompanionArt = staticCompositionLocalOf<CompanionArt> { TubbyArt }

@Composable
fun Companion(spec: CompanionSpec, modifier: Modifier = Modifier) {
  LocalCompanionArt.current.Render(spec, modifier.semantics { contentDescription = "Your companion, Tubby, looks ${spec.mood.name.lowercase()}" })
}

data class Palette(val top: Color, val bottom: Color, val tuft: Color, val tuftCore: Color, val cheek: Color)

object Palettes {
  fun of(skin: String): Palette = when (skin) {
    "skin_mint" -> Palette(Color(0xFF8EF0C4), Color(0xFF22B07D), Color(0xFFB8F5A0), Color(0xFFF2FFE0), Color(0xFFFF9DB0))
    "skin_grape" -> Palette(Color(0xFFC59BFF), Color(0xFF7A3FD6), Color(0xFFD9BDFF), Color(0xFFF6F0FF), Color(0xFFFF8FB8))
    "skin_sunset" -> Palette(Color(0xFFFFB07A), Color(0xFFE8622C), Color(0xFFFFCB9A), Color(0xFFFFF3E8), Color(0xFFFF7A8A))
    "skin_midnight" -> Palette(Color(0xFF6C7BC7), Color(0xFF2B3474), Color(0xFF8E9BDD), Color(0xFFE6EAFF), Color(0xFFFF9DC0))
    "skin_ocean" -> Palette(Color(0xFF7FD0FF), Color(0xFF3059DB), Color(0xFF9DEBFF), Color(0xFFEFFCFF), Color(0xFFFF9DC0))
    "skin_gold" -> Palette(Color(0xFFFFE98A), Color(0xFFE09A12), Color(0xFFFFF3B0), Color(0xFFFFFFF0), Color(0xFFFF8A65))
    else -> Palette(Color(0xFFFFA24C), Color(0xFFF0452E), Color(0xFFFFC23D), Color(0xFFFFF1B8), Color(0xFFFF7A8A))
  }
}

private val Ink = Color(0xFF2A1714)
private val Gray = Color(0xFF9AA0A6)

/** Fallback renderer: an original round flame-spirit ("Ember") drawn entirely with Canvas. */
object BlobArt : CompanionArt {
  @Composable
  override fun Render(spec: CompanionSpec, modifier: Modifier) {
    val inf = rememberInfiniteTransition(label = "companion")
    val phase by inf.animateFloat(
      0f, (2 * PI).toFloat(),
      infiniteRepeatable(tween(2600, easing = LinearEasing), RepeatMode.Restart), label = "phase",
    )
    val blink = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
      while (true) {
        delay(Random.nextLong(2200, 4800))
        blink.animateTo(0.08f, tween(70))
        blink.animateTo(1f, tween(130))
      }
    }
    val base = Palettes.of(spec.skin)
    val sadMix by animateFloatAsState(if (spec.mood == Mood.SAD) 0.4f else 0f, tween(500), label = "sad")
    val top by animateColorAsState(lerp(base.top, Gray, sadMix), tween(500), label = "top")
    val bottom by animateColorAsState(lerp(base.bottom, Gray, sadMix), tween(500), label = "bottom")
    val tuftScale by animateFloatAsState(
      when (spec.mood) { Mood.SAD -> 0.4f; Mood.WORRIED -> 0.8f; Mood.CELEBRATE -> 1.3f; else -> 1f }, tween(450), label = "tuft",
    )
    val pal = base.copy(top = top, bottom = bottom)

    Canvas(modifier) {
      drawCompanion(spec, pal, phase, blink.value, tuftScale)
    }
  }
}

fun DrawScope.drawCompanion(spec: CompanionSpec, pal: Palette, phase: Float, blink: Float, tuftScale: Float) {
  val s = minOf(size.width, size.height)
  val r = s * 0.3f
  val cx = size.width / 2f
  val groundY = size.height / 2f + r * 1.05f
  val mood = spec.mood

  val breathe = sin(phase)
  var sx = 1f + 0.035f * breathe
  var sy = 1f - 0.035f * breathe
  var dy = 0f
  var dx = 0f
  when (mood) {
    Mood.CELEBRATE -> { dy = -abs(sin(phase * 2f)) * r * 0.28f; sy += 0.03f }
    Mood.WORRIED -> dx = sin(phase * 9f) * r * 0.025f
    Mood.SAD -> { sy *= 0.93f; sx *= 1.04f }
    Mood.HAPPY -> dy = -abs(sin(phase)) * r * 0.06f
    Mood.SURPRISED -> dy = -r * 0.05f
    Mood.CALM -> Unit
  }
  val cy = groundY - r

  // ground shadow
  val lift = (-dy / (r * 0.28f)).coerceIn(0f, 1f)
  val shW = r * 1.5f * (1f - 0.3f * lift)
  drawOval(Color.Black.copy(alpha = 0.16f - 0.06f * lift), Offset(cx - shW / 2, groundY - r * 0.08f), Size(shW, r * 0.18f))

  withTransform({
    translate(dx, dy)
    scale(sx, sy, pivot = Offset(cx, groundY))
  }) {
    drawTuft(cx, cy - r * 0.86f, r, pal, phase, tuftScale)
    drawBody(cx, cy, r, pal, phase)
    drawFace(cx, cy, r, mood, pal, phase, blink)
  }
  if (mood == Mood.CELEBRATE) drawSparkles(cx, cy + dy, r, phase)
}

private fun blobPath(cx: Float, cy: Float, r: Float, phase: Float): Path {
  val n = 48
  val pts = List(n) { i ->
    val th = (2 * PI * i / n).toFloat()
    val wob = 1f + 0.022f * sin(3 * th + phase) + 0.016f * sin(5 * th - 2 * phase)
    var y = sin(th) * r * wob
    if (y > 0) y *= 0.92f // a slightly flatter bottom so it "sits"
    Offset(cx + cos(th) * r * wob * 1.04f, cy + y)
  }
  val p = Path()
  val mid = { a: Offset, b: Offset -> Offset((a.x + b.x) / 2, (a.y + b.y) / 2) }
  val start = mid(pts.last(), pts.first())
  p.moveTo(start.x, start.y)
  for (i in pts.indices) {
    val c = pts[i]
    val m = mid(c, pts[(i + 1) % n])
    p.quadraticTo(c.x, c.y, m.x, m.y)
  }
  p.close()
  return p
}

private fun DrawScope.drawBody(cx: Float, cy: Float, r: Float, pal: Palette, phase: Float) {
  val body = blobPath(cx, cy, r, phase)
  drawPath(body, Brush.verticalGradient(listOf(pal.top, pal.bottom), startY = cy - r, endY = cy + r))
  clipPath(body) {
    // soft rim light + belly glow
    drawOval(Color.White.copy(alpha = 0.22f), Offset(cx - r * 0.75f, cy - r * 0.85f), Size(r * 0.75f, r * 0.5f))
    drawOval(Color.White.copy(alpha = 0.12f), Offset(cx - r * 0.5f, cy + r * 0.25f), Size(r * 1.0f, r * 0.6f))
    drawOval(Color.Black.copy(alpha = 0.08f), Offset(cx - r * 1.2f, cy + r * 0.55f), Size(r * 2.4f, r * 0.9f))
  }
}

private fun DrawScope.drawTuft(cx: Float, baseY: Float, r: Float, pal: Palette, phase: Float, scale: Float) {
  fun flame(w: Float, h: Float, sway: Float, color: Color) {
    val p = Path().apply {
      moveTo(cx - w, baseY + r * 0.25f)
      cubicTo(cx - w * 1.1f, baseY - h * 0.35f, cx + sway - w * 0.2f, baseY - h * 0.7f, cx + sway, baseY - h)
      cubicTo(cx + sway + w * 0.35f, baseY - h * 0.6f, cx + w * 1.1f, baseY - h * 0.3f, cx + w, baseY + r * 0.25f)
      close()
    }
    drawPath(p, color)
  }
  val h = r * 0.62f * scale
  flame(r * 0.3f, h, sin(phase * 1.5f) * r * 0.09f, pal.tuft)
  flame(r * 0.16f, h * 0.62f, sin(phase * 1.5f + 0.6f) * r * 0.06f, pal.tuftCore)
}

private fun DrawScope.drawFace(cx: Float, cy: Float, r: Float, mood: Mood, pal: Palette, phase: Float, blink: Float) {
  val eyeDx = r * 0.36f
  val eyeY = cy - r * 0.1f
  val ew = r * 0.25f
  val eh = r * 0.31f
  val look = Offset(sin(phase * 0.5f) * r * 0.035f, when (mood) { Mood.SAD -> r * 0.05f; Mood.WORRIED -> -r * 0.02f; else -> 0f })

  // cheeks
  if (mood != Mood.SAD) {
    val a = if (mood == Mood.WORRIED) 0.25f else 0.5f
    for (sgn in listOf(-1f, 1f)) drawOval(pal.cheek.copy(alpha = a), Offset(cx + sgn * r * 0.62f - r * 0.13f, cy + r * 0.1f), Size(r * 0.26f, r * 0.15f))
  }

  for (sgn in listOf(-1f, 1f)) {
    val ex = cx + sgn * eyeDx
    if (mood == Mood.CELEBRATE) {
      // happy closed eyes: ^ ^
      drawArc(Ink, 200f, 140f, false, Offset(ex - ew * 0.6f, eyeY - eh * 0.2f), Size(ew * 1.2f, eh * 0.8f), style = Stroke(r * 0.07f, cap = StrokeCap.Round))
      continue
    }
    val h = eh * blink * if (mood == Mood.SAD) 0.75f else 1f
    drawOval(Color.White, Offset(ex - ew / 2, eyeY - h / 2), Size(ew, h))
    if (blink > 0.3f) {
      val pr = r * 0.095f
      val pc = Offset(ex, eyeY + r * 0.02f) + look
      drawCircle(Ink, pr, pc)
      drawCircle(Color.White, pr * 0.35f, pc + Offset(-pr * 0.35f, -pr * 0.4f))
    }
    // brows
    when (mood) {
      Mood.WORRIED, Mood.SAD -> {
        val tilt = if (mood == Mood.SAD) r * 0.1f else r * 0.07f
        drawLine(Ink, Offset(ex - sgn * ew * 0.55f, eyeY - eh * 0.75f + tilt * 0.2f), Offset(ex + sgn * ew * 0.55f, eyeY - eh * 0.75f + tilt), r * 0.05f, StrokeCap.Round)
      }
      else -> Unit
    }
  }

  val my = cy + r * 0.3f
  val stroke = Stroke(r * 0.065f, cap = StrokeCap.Round)
  when (mood) {
    Mood.SURPRISED -> drawOval(Ink, Offset(cx - r * 0.08f, my - r * 0.06f), Size(r * 0.16f, r * 0.2f))
    Mood.CALM -> drawArc(Ink, 30f, 120f, false, Offset(cx - r * 0.14f, my - r * 0.12f), Size(r * 0.28f, r * 0.16f), style = stroke)
    Mood.HAPPY -> drawArc(Ink, 15f, 150f, false, Offset(cx - r * 0.2f, my - r * 0.16f), Size(r * 0.4f, r * 0.26f), style = stroke)
    Mood.CELEBRATE -> {
      val m = Path().apply {
        moveTo(cx - r * 0.22f, my - r * 0.06f)
        quadraticTo(cx, my - r * 0.1f, cx + r * 0.22f, my - r * 0.06f)
        quadraticTo(cx + r * 0.2f, my + r * 0.28f, cx, my + r * 0.28f)
        quadraticTo(cx - r * 0.2f, my + r * 0.28f, cx - r * 0.22f, my - r * 0.06f)
        close()
      }
      drawPath(m, Color(0xFF6B1E1E))
      drawOval(Color(0xFFFF7E8A), Offset(cx - r * 0.1f, my + r * 0.1f), Size(r * 0.2f, r * 0.14f))
    }
    Mood.WORRIED -> {
      val w = Path().apply {
        moveTo(cx - r * 0.2f, my)
        quadraticTo(cx - r * 0.1f, my - r * 0.07f, cx, my)
        quadraticTo(cx + r * 0.1f, my + r * 0.07f, cx + r * 0.2f, my)
      }
      drawPath(w, Ink, style = stroke)
      // sweat drop
      val sx = cx + r * 0.82f
      val sy = cy - r * 0.5f + (sin(phase * 2f) * 0.5f + 0.5f) * r * 0.08f
      val d = Path().apply {
        moveTo(sx, sy - r * 0.16f)
        quadraticTo(sx + r * 0.11f, sy, sx, sy + r * 0.05f)
        quadraticTo(sx - r * 0.11f, sy, sx, sy - r * 0.16f)
      }
      drawPath(d, Color(0xFF9FE3FF))
    }
    Mood.SAD -> {
      drawArc(Ink, 205f, 130f, false, Offset(cx - r * 0.18f, my), Size(r * 0.36f, r * 0.24f), style = stroke)
      // a tear that slides down and loops
      val t = (phase / (2 * PI).toFloat())
      val tx = cx - eyeDx - r * 0.02f
      val ty = eyeY + eh * 0.4f + t * r * 0.45f
      drawCircle(Color(0xFF8FD3FF).copy(alpha = 1f - t * 0.7f), r * 0.05f, Offset(tx, ty))
    }
  }
}

internal fun DrawScope.drawSparkles(cx: Float, cy: Float, r: Float, phase: Float) {
  val spots = listOf(Offset(-1.35f, -0.9f), Offset(1.3f, -1.1f), Offset(-1.2f, 0.4f), Offset(1.4f, 0.2f))
  spots.forEachIndexed { i, o ->
    val tw = (sin(phase * 2 + i * 1.7f) * 0.5f + 0.5f)
    val c = Offset(cx + o.x * r, cy + o.y * r)
    val len = r * (0.08f + 0.1f * tw)
    val col = Color(0xFFFFE066).copy(alpha = 0.4f + 0.6f * tw)
    drawLine(col, c - Offset(len, 0f), c + Offset(len, 0f), r * 0.04f, StrokeCap.Round)
    drawLine(col, c - Offset(0f, len), c + Offset(0f, len), r * 0.04f, StrokeCap.Round)
  }
}
