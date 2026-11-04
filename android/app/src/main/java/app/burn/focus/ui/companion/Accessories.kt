package app.burn.focus.ui.companion

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import kotlin.math.cos
import kotlin.math.sin

/**
 * Props drawn over the pre-rendered Tubby frame in 512x512 frame coordinates,
 * matching the web SVG overlays in web/src/components/Accessories.tsx.
 */
@Composable
fun AccessoryOverlay(id: String?, modifier: Modifier = Modifier) {
  if (id == null || id !in NAMES) return
  Canvas(modifier) { drawAccessory(id) }
}

val NAMES = setOf("acc-bow", "acc-glasses", "acc-scarf", "acc-flowers", "acc-headphones", "acc-crown")

private fun DrawScope.drawAccessory(id: String) {
  val s = minOf(size.width, size.height)
  val ox = (size.width - s) / 2f
  val oy = (size.height - s) / 2f
  fun x(v: Float) = ox + v / 512f * s
  fun y(v: Float) = oy + v / 512f * s
  fun p(px: Float, py: Float) = Offset(x(px), y(py))
  fun sz(v: Float) = v / 512f * s

  when (id) {
    "acc-bow" -> rotate(12f, p(362f, 158f)) {
      val left = Path().apply {
        moveTo(x(362f), y(162f))
        cubicTo(x(316f), y(128f), x(288f), y(164f), x(346f), y(178f))
        close()
      }
      val right = Path().apply {
        moveTo(x(364f), y(162f))
        cubicTo(x(410f), y(128f), x(438f), y(164f), x(380f), y(178f))
        close()
      }
      drawPath(left, Color(0xFFFF6FA5))
      drawPath(right, Color(0xFFFF8AB8))
      drawCircle(Color(0xFFE94B86), sz(11f), p(364f, 162f))
      drawLine(Color(0xFFC53A76), p(360f, 174f), p(348f, 202f), sz(5f), StrokeCap.Round)
      drawLine(Color(0xFFC53A76), p(370f, 174f), p(382f, 200f), sz(5f), StrokeCap.Round)
    }

    "acc-glasses" -> {
      val lens = Color(0xFF202A36)
      drawRoundRect(lens, p(164f, 226f), Size(sz(76f), sz(52f)), CornerRadius(sz(22f)))
      drawRoundRect(lens, p(272f, 226f), Size(sz(76f), sz(52f)), CornerRadius(sz(22f)))
      drawRoundRect(lens, p(238f, 245f), Size(sz(36f), sz(10f)), CornerRadius(sz(5f)))
      drawLine(lens, p(164f, 244f), p(124f, 232f), sz(7f), StrokeCap.Round)
      drawLine(lens, p(348f, 244f), p(388f, 232f), sz(7f), StrokeCap.Round)
      drawLine(Color.White.copy(alpha = .45f), p(182f, 234f), p(210f, 234f), sz(5f), StrokeCap.Round)
      drawLine(Color.White.copy(alpha = .45f), p(290f, 234f), p(318f, 234f), sz(5f), StrokeCap.Round)
    }

    "acc-scarf" -> {
      val band = Path().apply {
        moveTo(x(152f), y(334f))
        quadraticTo(x(256f), y(384f), x(360f), y(334f))
        lineTo(x(352f), y(372f))
        quadraticTo(x(256f), y(422f), x(160f), y(372f))
        close()
      }
      drawPath(band, Color(0xFFE04B4B))
      val tail = Path().apply {
        moveTo(x(168f), y(366f))
        lineTo(x(192f), y(464f))
        lineTo(x(238f), y(446f))
        lineTo(x(214f), y(360f))
        close()
      }
      drawPath(tail, Color(0xFFC93B3B))
      drawLine(Color(0xFFFFD2D2).copy(alpha = .7f), p(172f, 390f), p(212f, 402f), sz(6f), StrokeCap.Round)
      drawLine(Color(0xFFFFD2D2).copy(alpha = .7f), p(178f, 416f), p(218f, 428f), sz(6f), StrokeCap.Round)
    }

    "acc-flowers" -> {
      drawArc(Color(0xFF4E9B52), 200f, 140f, false, p(122f, 100f), Size(sz(268f), sz(90f)), style = Stroke(sz(9f), cap = StrokeCap.Round))
      val spots = listOf(136f to 122f, 184f to 104f, 232f to 96f, 280f to 96f, 328f to 104f, 376f to 122f)
      spots.forEachIndexed { i, (px, py) ->
        val petal = if (i % 2 == 0) Color(0xFFFFF6D8) else Color(0xFFFFD6E7)
        for (a in 0 until 5) {
          val ang = Math.toRadians((a * 72).toDouble())
          drawCircle(petal, sz(7f), p(px + (cos(ang) * 10).toFloat(), py - (sin(ang) * 10).toFloat()))
        }
        drawCircle(Color(0xFFFFC93C), sz(6f), p(px, py))
      }
    }

    "acc-headphones" -> {
      val dark = Color(0xFF28313D)
      drawArc(dark, 180f, 180f, false, p(106f, 110f), Size(sz(300f), sz(300f)), style = Stroke(sz(24f), cap = StrokeCap.Round))
      drawArc(Color(0xFF455367).copy(alpha = .7f), 180f, 180f, false, p(106f, 110f), Size(sz(300f), sz(300f)), style = Stroke(sz(10f), cap = StrokeCap.Round))
      drawRoundRect(dark, p(84f, 212f), Size(sz(48f), sz(100f)), CornerRadius(sz(22f)))
      drawRoundRect(dark, p(380f, 212f), Size(sz(48f), sz(100f)), CornerRadius(sz(22f)))
      drawRoundRect(Color(0xFF5C6B80).copy(alpha = .55f), p(92f, 224f), Size(sz(32f), sz(76f)), CornerRadius(sz(15f)))
      drawRoundRect(Color(0xFF5C6B80).copy(alpha = .55f), p(388f, 224f), Size(sz(32f), sz(76f)), CornerRadius(sz(15f)))
    }

    "acc-crown" -> {
      val gold = Color(0xFFFFD34D)
      val crown = Path().apply {
        moveTo(x(182f), y(138f))
        lineTo(x(194f), y(70f))
        lineTo(x(230f), y(104f))
        lineTo(x(256f), y(56f))
        lineTo(x(282f), y(104f))
        lineTo(x(318f), y(70f))
        lineTo(x(330f), y(138f))
        close()
      }
      drawPath(crown, gold)
      drawPath(crown, Color(0xFFB87C09), style = Stroke(sz(5f)))
      drawRoundRect(Color(0xFFF3BB21), p(178f, 134f), Size(sz(156f), sz(18f)), CornerRadius(sz(8f)))
      drawCircle(Color(0xFFFF5F8F), sz(9f), p(256f, 116f))
      drawCircle(Color(0xFF67D4FF), sz(6f), p(211f, 118f))
      drawCircle(Color(0xFF67D4FF), sz(6f), p(301f, 118f))
    }
  }
}
