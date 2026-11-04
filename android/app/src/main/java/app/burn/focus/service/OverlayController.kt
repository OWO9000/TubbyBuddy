package app.burn.focus.service

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import app.burn.focus.ui.theme.BurnTheme

/**
 * A ComposeView outside an Activity needs its own Lifecycle, SavedStateRegistry and
 * ViewModelStore owners, otherwise composition crashes ("ViewTreeLifecycleOwner not found").
 */
class OverlayOwner : SavedStateRegistryOwner, ViewModelStoreOwner {
  private val registry = LifecycleRegistry(this)
  private val saved = SavedStateRegistryController.create(this)
  override val lifecycle: Lifecycle get() = registry
  override val savedStateRegistry: SavedStateRegistry get() = saved.savedStateRegistry
  override val viewModelStore = ViewModelStore()

  fun start() {
    saved.performAttach()
    saved.performRestore(null)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
  }

  fun stop() {
    if (registry.currentState == Lifecycle.State.DESTROYED) return
    registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
    registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
    viewModelStore.clear()
  }
}

/** Adds/removes the full-screen intercept window. Main thread only. */
class OverlayController(private val ctx: Context) {
  private val wm = ctx.getSystemService(WindowManager::class.java)
  private var root: View? = null
  private var owner: OverlayOwner? = null

  val isShowing: Boolean get() = root != null

  fun show(content: @Composable () -> Unit): Boolean {
    hide()
    if (!Settings.canDrawOverlays(ctx)) return false
    val o = OverlayOwner().also { it.start() }
    val frame = object : FrameLayout(ctx) {
      // Back does nothing: the user has to choose.
      override fun dispatchKeyEvent(event: KeyEvent): Boolean =
        if (event.keyCode == KeyEvent.KEYCODE_BACK) true else super.dispatchKeyEvent(event)
    }
    val compose = ComposeView(ctx).apply {
      setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
      setContent { BurnTheme { content() } }
    }
    for (v in listOf<View>(frame, compose)) {
      v.setViewTreeLifecycleOwner(o)
      v.setViewTreeSavedStateRegistryOwner(o)
      v.setViewTreeViewModelStoreOwner(o)
    }
    frame.addView(compose, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT,
    ).apply {
      if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      windowAnimations = android.R.style.Animation_Toast
      title = "TubbyBuddy intercept"
    }
    return try {
      wm.addView(frame, lp)
      root = frame; owner = o
      true
    } catch (e: RuntimeException) {
      o.stop(); false
    }
  }

  fun hide() {
    root?.let { runCatching { wm.removeViewImmediate(it) } }
    owner?.stop()
    root = null; owner = null
  }
}
