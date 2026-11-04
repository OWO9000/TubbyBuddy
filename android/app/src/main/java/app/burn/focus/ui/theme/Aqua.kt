package app.burn.focus.ui.theme

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.provider.Settings
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

/*
 * Native pieces of the shared look (web/src/theme.css): the paper valley, Aqua windows, group boxes, gel buttons,
 * Aqua checkboxes and letter tiles. Only the phone-only screens use these; everything else is the web app itself.
 */

// ---- Paper valley (a port of web/src/components/PaperScene.tsx, same seeds, same place) -------------------

private const val VW = 1600f
private const val VH = 1000f

private fun rng(seed: Int): () -> Double {
  var a = seed
  return {
    a += 0x6d2b79f5
    var t = a
    t = (t xor (t ushr 15)) * (t or 1)
    t = t xor (t + (t xor (t ushr 7)) * (t or 61))
    ((t xor (t ushr 14)).toUInt().toDouble()) / 4294967296.0
  }
}

private fun mountains(seed: Int, base: Double, peaks: Int, height: Double): (Double) -> Double {
  val r = rng(seed)
  data class P(val c: Double, val h: Double, val w: Double)
  val ps = List(peaks) { i -> P(((i + 0.2 + r() * 0.6) / peaks) * (VW + 200) - 100, height * (0.55 + r() * 0.45), 170 + r() * 190) }
  val ph = r() * 6
  return { x ->
    var lift = 0.0
    for (p in ps) lift = max(lift, p.h * max(0.0, 1 - abs(x - p.c) / p.w).pow(1.25))
    base - lift - 9 * sin(x / 61 + ph) - 5 * sin(x / 23 + ph * 2)
  }
}

private fun hills(seed: Int, base: Double, amp: Double): (Double) -> Double {
  val r = rng(seed)
  val waves = List(3) { i -> Triple((0.0018 + r() * 0.0022) * (i + 1), r() * 7, amp / (i + 1.2)) }
  return { x -> base - waves.sumOf { (f, p, a) -> a * sin(x * f + p) } }
}

private fun ridgePath(y: (Double) -> Double): String {
  val sb = StringBuilder("M-40 ${VH + 40} L-40 ${"%.1f".format(y(-40.0))}")
  var x = -40 + 16
  while (x <= VW + 40) { sb.append(" L$x ${"%.1f".format(y(x.toDouble()))}"); x += 16 }
  return sb.append(" L${VW + 40} ${VH + 40} Z").toString()
}

private fun ridgeLine(y: (Double) -> Double): String {
  val sb = StringBuilder("M-40 ${"%.1f".format(y(-40.0))}")
  var x = -40 + 16
  while (x <= VW + 40) { sb.append(" L$x ${"%.1f".format(y(x.toDouble()))}"); x += 16 }
  return sb.toString()
}

private fun pine(x: Double, y0: Double, h: Double): String {
  val w = h * 0.42
  val t = y0 - h
  return "M$x $t L${x + w * 0.62} ${t + h * 0.48} L${x + w * 0.36} ${t + h * 0.46} L${x + w} $y0 L${x - w} $y0 L${x - w * 0.36} ${t + h * 0.46} L${x - w * 0.62} ${t + h * 0.48} Z"
}

private data class Tree(val round: Boolean, val x: Double, val h: Double, val r: Double, val tint: Color?)

private fun trees(seed: Int, count: Int, minH: Double, maxH: Double, roundShare: Double, tints: List<Color>, maxR: Double): List<Tree> {
  val r = rng(seed)
  return List(count) {
    val round = r() < roundShare
    val h = minH + r() * (maxH - minH)
    val x = -20 + r() * (VW + 40)
    val tint = if (round && tints.isNotEmpty() && r() < 0.35) tints[(r() * tints.size).toInt()] else null
    Tree(round, x, if (round) minOf(h, maxR * 2.6) else h, minOf(h * 0.24, maxR), tint)
  }
}

private class Layer(val depth: Float, val fill: Path, val rim: Path, val top: Color, val bottom: Color, val treeColor: Color?, val pines: List<Path>, val rounds: List<Pair<Tree, Double>>)

private fun parse(d: String): Path = PathParser().parsePathString(d).toPath()

private val CLOUD = "M-120 30 C-120 6 -96 -6 -74 0 C-66 -34 -24 -44 2 -24 C18 -54 70 -52 82 -14 C108 -18 128 4 120 30 Z"

private val valley: List<Layer> by lazy {
  data class Spec(val depth: Float, val ridge: (Double) -> Double, val top: Long, val bottom: Long, val tree: Long? = null, val trees: List<Tree> = emptyList())
  listOf(
    Spec(0.16f, mountains(7, 600.0, 5, 300.0), 0xFFE2F2FD, 0xFFCDE7FA),
    Spec(0.26f, mountains(19, 660.0, 6, 240.0), 0xFFC3E3F9, 0xFFA9D6F5),
    Spec(0.40f, hills(3, 720.0, 46.0), 0xFF9FD2F2, 0xFF86C4EC, 0xFF7DBDE8, trees(11, 16, 34.0, 64.0, 0.55, emptyList(), 14.0)),
    Spec(0.60f, hills(29, 800.0, 40.0), 0xFF73B6E6, 0xFF5EA8DF, 0xFF539ED8, trees(23, 24, 50.0, 104.0, 0.4, listOf(Color(0xFFE6F4FD), Color(0xFFD2EBFB)), 20.0)),
    Spec(0.90f, hills(41, 905.0, 34.0), 0xFF4F9BD6, 0xFF3F89C7, 0xFF3A82C0, trees(37, 16, 90.0, 170.0, 0.3, listOf(Color(0xFFDFF0FC)), 28.0)),
  ).map { s ->
    Layer(
      s.depth, parse(ridgePath(s.ridge)), parse(ridgeLine(s.ridge)), Color(s.top), Color(s.bottom), s.tree?.let { Color(it) },
      s.trees.filter { !it.round }.map { parse(pine(it.x, s.ridge(it.x) + 10, it.h)) },
      s.trees.filter { it.round }.map { it to s.ridge(it.x) + 10 },
    )
  }
}
private val cloudPath by lazy { parse(CLOUD) }

/** Tilt parallax from the gravity sensor, like the web's parallax-js gyroscope mode. Off when animations are off. */
@Composable
private fun rememberTilt(): Offset {
  val ctx = LocalContext.current
  var tilt by remember { mutableStateOf(Offset.Zero) }
  DisposableEffect(ctx) {
    val animationsOff = runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    val sensor = sm?.getDefaultSensor(Sensor.TYPE_GRAVITY)
    if (animationsOff || sm == null || sensor == null) return@DisposableEffect onDispose { }
    var sx = 0f
    var sy = 0f
    val l = object : SensorEventListener {
      override fun onSensorChanged(e: SensorEvent) {
        sx += ((e.values[0] / 9.81f).coerceIn(-1f, 1f) - sx) * 0.08f
        sy += (((e.values[1] / 9.81f) - 0.7f).coerceIn(-1f, 1f) - sy) * 0.08f
        tilt = Offset(sx, sy)
      }
      override fun onAccuracyChanged(s: Sensor?, a: Int) = Unit
    }
    sm.registerListener(l, sensor, SensorManager.SENSOR_DELAY_GAME)
    onDispose { sm.unregisterListener(l) }
  }
  return tilt
}

/** The light-blue paper-cut valley behind every native screen. */
@Composable
fun PaperValley(modifier: Modifier = Modifier, parallax: Boolean = true, content: @Composable BoxScope.() -> Unit = {}) {
  val tilt = if (parallax) rememberTilt() else Offset.Zero
  Box(modifier.fillMaxSize().background(BurnColors.Sky)) {
    Canvas(Modifier.fillMaxSize()) {
      drawRect(Brush.verticalGradient(0f to Color(0xFF6DB3F0), 0.45f to Color(0xFFACE0FB), 0.75f to Color(0xFFDCF1FD), 1f to Color(0xFFF2FAFF)))
      // "xMidYMax slice", with 8% slack on each side for the parallax.
      val s = max(size.width / VW, size.height / VH) * 1.08f
      val ox = (size.width - VW * s) / 2f
      val oy = size.height - VH * s + 0.04f * VH * s
      val shift = 22.dp.toPx()
      fun layer(depth: Float, draw: androidx.compose.ui.graphics.drawscope.DrawScope.() -> Unit) =
        withTransform({
          translate(ox - tilt.x * shift * depth * 2f, oy + tilt.y * shift * depth)
          scale(s, s, Offset.Zero)
        }) { draw() }
      layer(0.06f) {
        val c = Offset(1250f, 230f)
        drawCircle(Color(0x24FFF8E4), 112f, c); drawCircle(Color(0x33FFF8E4), 92f, c); drawCircle(Color(0x4DFFF8E4), 72f, c); drawCircle(Color(0xFFFFF6DC), 52f, c)
      }
      layer(0.12f) {
        for ((x, y, k) in listOf(Triple(240f, 190f, 1.15f), Triple(820f, 120f, 0.8f), Triple(1480f, 330f, 0.95f))) {
          translate(x - 3f, y + 5f) { withTransform({ scale(k, k, Offset.Zero) }) { drawPath(cloudPath, Color(0x2614467A)) } }
          translate(x, y) { withTransform({ scale(k, k, Offset.Zero) }) { drawPath(cloudPath, Color.White) } }
        }
      }
      for (l in valley) {
        layer(l.depth) {
          // Cut paper: two soft offset shadows, the fill, then a bright cut edge along the ridge.
          translate(-12f, 18f) { drawPath(l.fill, Color(0x1414467A)) }
          translate(-3f, 5f) { drawPath(l.fill, Color(0x3014467A)) }
          l.treeColor?.let { tc ->
            for (p in l.pines) { translate(-3f, 5f) { drawPath(p, Color(0x2614467A)) }; drawPath(p, tc) }
            for ((t, y0) in l.rounds) {
              drawRect(tc, Offset(t.x.toFloat() - 2.5f, (y0 - t.r * 2.2).toFloat()), Size(5f, (t.r * 2.2).toFloat()))
              drawCircle(t.tint ?: tc, t.r.toFloat(), Offset(t.x.toFloat(), (y0 - t.r * 2.3).toFloat()))
            }
          }
          drawPath(l.fill, Brush.verticalGradient(listOf(l.top, l.bottom), startY = 500f, endY = VH))
          drawPath(l.rim, Color(0x80FFFFFF), style = Stroke(width = 2f / s * 1.2f))
        }
      }
      // Vignette, like .paper-vignette.
      drawRect(Brush.radialGradient(listOf(Color.Transparent, Color(0x1A08284F)), center = Offset(size.width / 2, size.height * 0.4f), radius = size.maxDimension * 0.85f))
    }
    content()
  }
}

// ---- Windows and group boxes ----------------------------------------------------------------------------

private fun Modifier.pinstripe(period: Dp = 3.dp, a: Color = BurnColors.Stripe1, b: Color = BurnColors.Stripe2) = drawBehind {
  drawRect(a)
  val p = period.toPx()
  var y = p / 2
  while (y < size.height) { drawRect(b, Offset(0f, y), Size(size.width, p / 2)); y += p }
}

@Composable
private fun TrafficLight(top: Color, mid: Color, low: Color, modifier: Modifier = Modifier) {
  Canvas(modifier.size(13.dp)) {
    val r = size.minDimension / 2
    drawCircle(Brush.radialGradient(listOf(top, mid, low), center = Offset(r, r * 1.5f), radius = r * 1.6f), r)
    drawCircle(Color(0x61000000), r - 0.5f, style = Stroke(1f))
    drawOval(Brush.verticalGradient(listOf(Color(0xF2FFFFFF), Color(0x1AFFFFFF)), startY = 1.5f, endY = r), Offset(r * 0.35f, 1.5f), Size(r * 1.3f, r * 0.9f))
  }
}

/** An Aqua window: gradient title bar with traffic lights (the red one closes when [onClose] is set), pinstripe body. */
@Composable
fun AquaWindow(
  title: String,
  modifier: Modifier = Modifier,
  onClose: (() -> Unit)? = null,
  bodyPadding: PaddingValues = PaddingValues(16.dp),
  content: @Composable ColumnScope.() -> Unit,
) {
  val shape = RoundedCornerShape(9.dp, 9.dp, 7.dp, 7.dp)
  Column(
    modifier
      .shadow(22.dp, shape, ambientColor = Color(0xFF062248), spotColor = Color(0xFF062248))
      .clip(shape)
      .border(1.dp, Color(0x4D000000), shape)
      .pinstripe(),
  ) {
    Box(
      Modifier.fillMaxWidth().height(28.dp)
        .background(Brush.verticalGradient(listOf(Color(0xFFECECEC), Color(0xFFD3D3D3))))
        .drawBehind { drawRect(Color(0xFF9EA3AA), Offset(0f, size.height - 1f), Size(size.width, 1f)) },
      contentAlignment = Alignment.Center,
    ) {
      Row(Modifier.align(Alignment.CenterStart).padding(start = 9.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        val close = Modifier.let { m -> if (onClose != null) m.clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Close", onClick = onClose) else m }
        TrafficLight(Color(0xFFFFB3A8), Color(0xFFF0503F), Color(0xFFB8261A), close)
        TrafficLight(Color(0xFFFFE7A6), Color(0xFFF4B62A), Color(0xFFB77C00))
        TrafficLight(Color(0xFFC9F5AD), Color(0xFF4FBF37), Color(0xFF23801A))
      }
      Text(
        title, style = MaterialTheme.typography.titleSmall.copy(shadow = Shadow(Color(0xD9FFFFFF), Offset(0f, 1f), 0f)),
        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 72.dp),
      )
    }
    Column(Modifier.padding(bodyPadding), content = content)
  }
}

/** The white rounded panel inside a window (web `.card`). */
@Composable
fun GroupBox(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(14.dp), content: @Composable ColumnScope.() -> Unit) {
  val shape = RoundedCornerShape(8.dp)
  Column(modifier.fillMaxWidth().clip(shape).background(Color(0xB3FFFFFF)).border(1.dp, BurnColors.GroupLine, shape).padding(padding), content = content)
}

// ---- Controls --------------------------------------------------------------------------------------------

enum class GelKind { Default, Secondary, Destructive }

/** Aqua gel pill button (web `button.aqua-btn`). [throb] gives the main action on a screen its gentle pulse. */
@Composable
fun GelButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  kind: GelKind = GelKind.Default,
  enabled: Boolean = true,
  large: Boolean = false,
  throb: Boolean = false,
) {
  val stops = when (kind) {
    GelKind.Default -> listOf(0f to Color(0xFFB9DCFF), 0.42f to Color(0xFF6CB0F7), 0.5f to BurnColors.Accent, 0.78f to Color(0xFF4D9CF2), 1f to Color(0xFF9FD7FF))
    GelKind.Secondary -> listOf(0f to Color(0xFFFDFDFE), 0.48f to Color(0xFFE4E7EC), 0.52f to Color(0xFFD3D7DE), 1f to Color(0xFFECEEF2))
    GelKind.Destructive -> listOf(0f to Color(0xFFFFC4C4), 0.42f to Color(0xFFF7826C), 0.5f to Color(0xFFE03A2F), 0.78f to Color(0xFFF2604D), 1f to Color(0xFFFFB09F))
  }
  val edge = when (kind) { GelKind.Default -> BurnColors.Edge; GelKind.Secondary -> Color(0xFFAEB3BC); GelKind.Destructive -> Color(0xFFA81F1F) }
  val fg = if (kind == GelKind.Secondary) Color(0xFF3A3F47) else Color.White
  val shadow = if (kind == GelKind.Secondary) Shadow(Color(0xCCFFFFFF), Offset(0f, 1.5f), 0f) else Shadow(Color(0x59001E50), Offset(0f, -1.5f), 1f)
  val pulse = if (throb && enabled) {
    rememberInfiniteTransition(label = "throb").animateFloat(0f, 0.14f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "glow").value
  } else 0f
  val source = remember { MutableInteractionSource() }
  val pressed by source.collectIsPressedAsState()
  val shape = RoundedCornerShape(50)
  Box(
    modifier
      .heightIn(min = if (large) 48.dp else 38.dp)
      .alpha(if (enabled) 1f else 0.5f)
      .shadow(2.dp, shape, ambientColor = Color(0xFF143C82), spotColor = Color(0xFF143C82))
      .clip(shape)
      .background(Brush.verticalGradient(*stops.toTypedArray()))
      .border(1.dp, edge, shape)
      .drawWithContent {
        drawContent()
        // Top gloss, like `.aqua-btn::before`.
        val w = size.width
        drawRoundRect(
          Brush.verticalGradient(listOf(Color(0xADFFFFFF), Color(0x08FFFFFF)), startY = 1f, endY = size.height * 0.45f),
          Offset(w * 0.04f, 1.5f), Size(w * 0.92f, size.height * 0.44f), CornerRadius(size.height),
          alpha = if (kind == GelKind.Secondary) 0.55f else 1f,
        )
        if (pulse > 0f) drawRect(Color.White.copy(alpha = pulse))
        if (pressed) drawRect(Color.Black.copy(alpha = 0.06f))
      }
      .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
      .padding(horizontal = if (large) 26.dp else 18.dp, vertical = if (large) 12.dp else 9.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text,
      style = TextStyle(fontFamily = Fira, fontWeight = FontWeight.SemiBold, fontSize = if (large) 17.sp else 15.sp, color = fg, shadow = shadow, textAlign = TextAlign.Center),
      maxLines = 2,
    )
  }
}

/** Inset text field (web inputs inside group boxes). */
@Composable
fun AquaField(
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String = "",
  leading: (@Composable () -> Unit)? = null,
) {
  val shape = RoundedCornerShape(50)
  androidx.compose.foundation.text.BasicTextField(
    value = value,
    onValueChange = onChange,
    singleLine = true,
    textStyle = MaterialTheme.typography.bodyLarge,
    cursorBrush = androidx.compose.ui.graphics.SolidColor(BurnColors.Accent),
    modifier = modifier.fillMaxWidth(),
    decorationBox = { inner ->
      Row(
        Modifier.fillMaxWidth().height(42.dp).clip(shape).background(Color.White).border(1.dp, Color(0xFFA3B0C0), shape)
          .drawBehind { drawRect(Color(0x14000000), Offset.Zero, Size(size.width, 2f)) }
          .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        leading?.let { it(); androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp)) }
        Box(Modifier.weight(1f)) {
          if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge.copy(color = BurnColors.Muted), maxLines = 1)
          inner()
        }
      }
    },
  )
}

/** Aqua checkbox (web `.switch input`). */
@Composable
fun AquaCheck(checked: Boolean, onChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, label: String? = null) {
  val shape = RoundedCornerShape(4.dp)
  Box(
    modifier
      .size(22.dp)
      .clip(shape)
      .background(
        if (checked) Brush.verticalGradient(0f to Color(0xFFA8D0F7), 0.5f to Color(0xFF4A90EC), 0.51f to Color(0xFF2A6FD0), 1f to Color(0xFF6AABF3))
        else Brush.verticalGradient(listOf(Color.White, Color(0xFFE1E4E8))),
      )
      .border(1.dp, if (checked) BurnColors.Edge else Color(0xFF8A9099), shape)
      .let { m -> if (onChange != null) m.clickable(role = Role.Checkbox, onClickLabel = label) { onChange(!checked) } else m },
    contentAlignment = Alignment.Center,
  ) {
    if (checked) {
      Canvas(Modifier.size(12.dp)) {
        val p = Path().apply { moveTo(size.width * 0.12f, size.height * 0.55f); lineTo(size.width * 0.4f, size.height * 0.82f); lineTo(size.width * 0.9f, size.height * 0.18f) }
        drawPath(p, Color.White, style = Stroke(width = 2.6.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
      }
    }
  }
}

/** Pill chip (web `.pick-chip`): white gel, blue when on. */
@Composable
fun PickChip(text: String, on: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val shape = RoundedCornerShape(50)
  Box(
    modifier
      .clip(shape)
      .background(
        if (on) Brush.verticalGradient(0f to Color(0xFFA8D0F7), 0.5f to Color(0xFF4A90EC), 0.51f to Color(0xFF2A6FD0), 1f to Color(0xFF6AABF3))
        else Brush.verticalGradient(0f to Color.White, 0.48f to Color(0xFFEEF0F3), 0.52f to Color(0xFFE2E5EA), 1f to Color(0xFFF4F5F7)),
      )
      .border(1.dp, if (on) BurnColors.Edge else Color(0xFFA7ADB5), shape)
      .clickable(role = Role.Button, onClick = onClick)
      .padding(horizontal = 13.dp, vertical = 7.dp),
  ) {
    Text(text, style = MaterialTheme.typography.labelMedium.copy(color = if (on) Color.White else BurnColors.Text), maxLines = 1)
  }
}

private val TILE_HUES = intArrayOf(204, 338, 28, 262, 160, 12, 190, 46)

private fun hsl(h: Float, s: Float, l: Float): Color {
  val c = (1 - abs(2 * l - 1)) * s
  val x = c * (1 - abs((h / 60f) % 2 - 1))
  val m = l - c / 2
  val (r, g, b) = when ((h / 60).toInt()) { 0 -> Triple(c, x, 0f); 1 -> Triple(x, c, 0f); 2 -> Triple(0f, c, x); 3 -> Triple(0f, x, c); 4 -> Triple(x, 0f, c); else -> Triple(c, 0f, x) }
  return Color(r + m, g + m, b + m)
}

/** Neutral letter tile for an app (web `AppTile`): never the app's own logo. */
@Composable
fun AppTile(name: String, size: Dp = 40.dp, modifier: Modifier = Modifier) {
  val clean = name.trim().ifEmpty { "?" }
  var h = 0L
  for (ch in clean.lowercase()) h = (h * 31 + ch.code) and 0xffffffffL
  val hue = TILE_HUES[(h % TILE_HUES.size).toInt()].toFloat()
  val shape = RoundedCornerShape(size * 0.26f)
  Box(
    modifier.size(size).shadow(2.dp, shape).clip(shape)
      .background(Brush.verticalGradient(listOf(hsl(hue, 0.8f, 0.7f), hsl(hue, 0.7f, 0.48f))))
      .border(1.dp, Color(0x24000000), shape),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      clean.first().uppercase(),
      style = TextStyle(fontFamily = Fira, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.46f).sp, color = Color.White, shadow = Shadow(Color(0x40000000), Offset(0f, -1.5f), 0f)),
    )
  }
}
