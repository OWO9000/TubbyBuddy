package app.burn.focus.ui.companion

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** Cheap, non-animated thumbnail of a [CompanionSpec]: one frozen frame. */
@Composable
fun StaticCompanion(spec: CompanionSpec, modifier: Modifier = Modifier) {
  val m = modifier.semantics { contentDescription = "Preview of Tubby the companion" }
  if (LocalCompanionArt.current === BlobArt) {
    Canvas(m) {
      drawCompanion(
        spec,
        Palettes.of(spec.skin),
        phase = 0.6f,
        blink = 1f,
        tuftScale = 1f,
      )
    }
  } else {
    TubbyStatic(spec, m)
  }
}
