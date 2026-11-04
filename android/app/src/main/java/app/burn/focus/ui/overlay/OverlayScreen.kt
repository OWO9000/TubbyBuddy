package app.burn.focus.ui.overlay

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import app.burn.focus.domain.Outcome
import app.burn.focus.ui.companion.Companion
import app.burn.focus.ui.companion.CompanionSpec
import app.burn.focus.ui.companion.Mood
import app.burn.focus.ui.theme.AquaWindow
import app.burn.focus.ui.theme.BurnColors
import app.burn.focus.ui.theme.GelButton
import app.burn.focus.ui.theme.GelKind
import app.burn.focus.ui.theme.GroupBox
import app.burn.focus.ui.theme.PaperValley
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.sin
import kotlin.random.Random

data class OverlayModel(
  val pkg: String,
  val appLabel: String,
  val nudge: String,
  val points: Int,
  val atRisk: Int,
  val streak: Int,
  val spec: CompanionSpec,
  val preview: Boolean = false,
)

private enum class Step { ASK, RESISTED, BURNING }

/**
 * The block screen, the same one the Windows app shows (desktop/overlay/block.html): the valley, an Aqua window,
 * Tubby, "Hold up.", what's at stake, and two ways out. Putting it down never pays points; continuing burns them.
 */
@Composable
fun OverlayScreen(
  model: OverlayModel,
  onPutDown: suspend () -> Outcome,
  onBurn: suspend () -> Outcome,
  onFinished: (resisted: Boolean) -> Unit,
) {
  var step by remember { mutableStateOf(Step.ASK) }
  var result by remember { mutableStateOf<Outcome?>(null) }
  var shown by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val counter = remember { Animatable(model.points.toFloat()) }
  val heat = remember { Animatable(0f) }
  var startled by remember { mutableStateOf(true) }
  LaunchedEffect(Unit) {
    shown = true
    delay(1200)
    startled = false
  }

  val mood = when (step) {
    Step.ASK -> if (startled) Mood.SURPRISED else Mood.WORRIED
    Step.RESISTED -> Mood.CELEBRATE
    Step.BURNING -> Mood.SAD
  }

  PaperValley(parallax = false) {
    Box(Modifier.fillMaxSize().alpha(heat.value * 0.35f).background(Brush.verticalGradient(listOf(Color.Transparent, BurnColors.Bad))))
    if (step == Step.BURNING) Embers(Modifier.fillMaxSize())

    BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 14.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
      val cat = min(200.dp, maxHeight * 0.26f)
      AnimatedVisibility(shown, enter = fadeIn(tween(180)) + scaleIn(tween(240), initialScale = 0.96f) + slideInVertically(tween(260)) { it / 16 }, exit = fadeOut()) {
        AquaWindow(
          if (model.preview) "TubbyBuddy · preview" else "TubbyBuddy",
          Modifier.widthIn(max = 480.dp).fillMaxWidth(),
        ) {
          Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Opening ${model.appLabel}…", style = MaterialTheme.typography.labelMedium.copy(color = BurnColors.Muted))
            Companion(model.spec.copy(mood = mood), Modifier.size(cat))
            AnimatedContent(step, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "step") { s ->
              Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                when (s) {
                  Step.ASK -> {
                    Text("Hold up.", style = MaterialTheme.typography.displaySmall)
                    Spacer(Modifier.height(8.dp))
                    Text(model.nudge, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                  }
                  Step.RESISTED -> {
                    Text("Good call.", style = MaterialTheme.typography.displaySmall)
                    Spacer(Modifier.height(8.dp))
                    Text(
                      "${model.appLabel} stays closed. Your points and streak are safe.",
                      style = MaterialTheme.typography.titleMedium.copy(color = BurnColors.Good), textAlign = TextAlign.Center,
                    )
                  }
                  Step.BURNING -> {
                    Text("Logged.", style = MaterialTheme.typography.displaySmall.copy(color = BurnColors.Bad))
                    Spacer(Modifier.height(8.dp))
                    val burned = result?.points ?: model.atRisk
                    Text(
                      when {
                        model.preview -> "In the real thing, that burns $burned points and resets your streak."
                        burned > 0 -> "-$burned points. ${model.appLabel} is open for 10 minutes."
                        else -> "No points to burn. ${model.appLabel} is open for 10 minutes."
                      },
                      style = MaterialTheme.typography.titleMedium.copy(color = BurnColors.Muted), textAlign = TextAlign.Center,
                    )
                  }
                }
              }
            }
            Spacer(Modifier.height(14.dp))
            Stakes(counter.value.toInt(), model.atRisk, model.streak, burning = step == Step.BURNING)
            Spacer(Modifier.height(14.dp))
            if (step == Step.ASK) {
              GelButton(
                "Put it down",
                {
                  if (step != Step.ASK) return@GelButton
                  step = Step.RESISTED
                  scope.launch {
                    result = onPutDown()
                    delay(900)
                    onFinished(true)
                  }
                },
                Modifier.fillMaxWidth(), large = true, throb = true,
              )
              Spacer(Modifier.height(10.dp))
              GelButton(
                if (model.atRisk > 0) "Continue anyway (burn ${model.atRisk})" else "Continue anyway",
                {
                  if (step != Step.ASK) return@GelButton
                  step = Step.BURNING
                  scope.launch {
                    val o = onBurn()
                    result = o
                    launch { heat.animateTo(1f, tween(350)); heat.animateTo(0.3f, tween(900)) }
                    counter.animateTo((model.points - o.points).toFloat(), tween(1100, easing = FastOutSlowInEasing))
                    delay(800)
                    onFinished(false)
                  }
                },
                Modifier.fillMaxWidth(), kind = GelKind.Destructive,
              )
              Spacer(Modifier.height(10.dp))
              Text(
                "Putting it down keeps your points and streak. Continuing burns points and resets the streak.",
                style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
              )
            } else {
              Spacer(Modifier.height(48.dp))
            }
          }
        }
      }
    }
  }
}

/** points · at risk · streak, the same three numbers the Windows guard shows. */
@Composable
private fun Stakes(points: Int, atRisk: Int, streak: Int, burning: Boolean) {
  GroupBox(padding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp)) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.SpaceEvenly) {
      Stat("$points", "points", if (burning) BurnColors.Bad else BurnColors.Text, Modifier.weight(1f))
      Divider()
      Stat("$atRisk", "at risk", BurnColors.Bad, Modifier.weight(1f))
      Divider()
      Stat("${streak}d", "streak", BurnColors.Text, Modifier.weight(1f))
    }
  }
}

@Composable
private fun Divider() = Box(Modifier.width(1.dp).fillMaxHeight().background(Color(0xFFD3D7DC)))

@Composable
private fun Stat(value: String, label: String, color: Color, modifier: Modifier) {
  Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
    Text(value, style = MaterialTheme.typography.titleLarge.copy(color = color))
    Text(label, style = MaterialTheme.typography.bodySmall)
  }
}

/** Rising ember particles for the burn moment. */
@Composable
private fun Embers(modifier: Modifier) {
  val t = remember { Animatable(0f) }
  LaunchedEffect(Unit) { t.animateTo(1f, tween(1800, easing = LinearEasing)) }
  val seeds = remember { List(36) { Triple(Random.nextFloat(), Random.nextFloat(), Random.nextFloat()) } }
  Canvas(modifier) {
    seeds.forEach { (x, speed, size0) ->
      val p = (t.value * (0.6f + speed)).coerceAtMost(1f)
      val y = size.height * (1.05f - p * (0.7f + speed * 0.4f))
      val cx = size.width * x + sin((p * 6f + x * 10f)) * 18f
      val a = (1f - p).coerceIn(0f, 1f)
      drawCircle(Color(0xFFFFB347).copy(alpha = a), 3f + size0 * 7f, Offset(cx, y))
      drawCircle(Color(0xFFFF5A2A).copy(alpha = a * 0.5f), 7f + size0 * 10f, Offset(cx, y))
    }
  }
}
