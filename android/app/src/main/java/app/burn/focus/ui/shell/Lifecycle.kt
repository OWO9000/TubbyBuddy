package app.burn.focus.ui.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

/** Bumps every time the screen resumes (e.g. coming back from Android settings) so permission checks re-run. */
@Composable
fun rememberResumeTick(): Int {
  var tick by remember { mutableIntStateOf(0) }
  val owner = LocalLifecycleOwner.current
  DisposableEffect(owner) {
    val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) tick++ }
    owner.lifecycle.addObserver(obs)
    onDispose { owner.lifecycle.removeObserver(obs) }
  }
  return tick
}
