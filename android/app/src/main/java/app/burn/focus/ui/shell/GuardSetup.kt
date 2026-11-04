package app.burn.focus.ui.shell

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.burn.focus.burnApp
import app.burn.focus.data.InstalledApps
import app.burn.focus.data.LaunchableApp
import app.burn.focus.data.Perm
import app.burn.focus.data.Permissions
import app.burn.focus.domain.AppCategory
import app.burn.focus.domain.AppState
import app.burn.focus.domain.BlockedApp
import app.burn.focus.service.GuardService
import app.burn.focus.ui.theme.AppTile
import app.burn.focus.ui.theme.AquaCheck
import app.burn.focus.ui.theme.AquaField
import app.burn.focus.ui.theme.AquaWindow
import app.burn.focus.ui.theme.BurnColors
import app.burn.focus.ui.theme.GelButton
import app.burn.focus.ui.theme.GelKind
import app.burn.focus.ui.theme.GroupBox
import app.burn.focus.ui.theme.PaperValley
import app.burn.focus.ui.theme.PickChip
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The phone-only part of Settings: Android permissions, the installed-app picker and the guard switch. Everything
 * else (goals, rewards, account) lives in the shared screens.
 */
/** Callbacks the phone guard screen needs; real ones come from [GuardSetupScreen], previews pass fakes. */
class GuardSetupActions(
  val close: () -> Unit,
  val toggleApp: (LaunchableApp) -> Unit,
  val setGuard: (Boolean) -> Unit,
  val openPerm: (Perm) -> Unit,
  val preview: () -> Unit,
  val saveServer: suspend (String) -> String,
)

@Composable
fun GuardSetupScreen(state: AppState, onClose: () -> Unit) {
  val ctx = LocalContext.current
  val repo = ctx.burnApp.repo
  val scope = rememberCoroutineScope()
  val tick = rememberResumeTick()
  var asked by remember { mutableStateOf(false) }
  val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { asked = true }
  val perms = remember(tick, asked) { Perm.entries.associateWith { Permissions.granted(ctx, it) } }
  val ready = Perm.entries.filter { it.required }.all { perms[it] == true }
  val apps by produceState<List<LaunchableApp>?>(null) { value = withContext(Dispatchers.IO) { InstalledApps.launchable(ctx) } }
  var changed by remember { mutableStateOf(false) }

  // Permissions granted while the guard is meant to be on: start it right away.
  LaunchedEffect(ready, state.guardEnabled) {
    if (ready && state.guardEnabled) GuardService.start(ctx)
  }

  val actions = GuardSetupActions(
    close = {
      if (changed) scope.launch { repo.pushGuardedNames() }
      onClose()
    },
    toggleApp = { app ->
      changed = true
      scope.launch {
        val now = state.blockedApps
        repo.setBlocked(if (app.pkg in state.blockedPkgs) now.filter { it.pkg != app.pkg } else now + BlockedApp(app.pkg, app.label, app.category.id))
      }
    },
    setGuard = { on ->
      scope.launch { repo.setGuardEnabled(on); repo.setOnboarded(true) }
      if (on) GuardService.start(ctx) else GuardService.stop(ctx)
    },
    openPerm = { p ->
      if (p == Perm.NOTIFICATIONS && Build.VERSION.SDK_INT >= 33 && !asked) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      else Permissions.open(ctx, p)
    },
    preview = { GuardService.preview(ctx) },
    saveServer = { url -> if (!repo.setBackendUrl(url)) "That doesn't look like a web address." else repo.testConnection() },
  )
  BackHandler { actions.close() }
  GuardSetupBody(state, perms, apps, notificationsAsk = Build.VERSION.SDK_INT >= 33 && !asked, actions = actions)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GuardSetupBody(state: AppState, perms: Map<Perm, Boolean>, apps: List<LaunchableApp>?, notificationsAsk: Boolean, actions: GuardSetupActions) {
  val scope = rememberCoroutineScope()
  val ready = Perm.entries.filter { it.required }.all { perms[it] == true }
  var query by remember { mutableStateOf("") }
  var category by remember { mutableStateOf<AppCategory?>(null) }
  var url by remember { mutableStateOf(state.backendUrl) }
  var serverNote by remember { mutableStateOf<String?>(null) }
  val all = apps.orEmpty()
  val categories = AppCategory.entries.filter { c -> all.any { it.category == c } }
  val visible = all.filter { a ->
    (category == null || a.category == category) && (query.isBlank() || a.label.contains(query, true))
  }

  PaperValley {
    Box(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp), contentAlignment = Alignment.TopCenter) {
      AquaWindow("Phone guard", Modifier.widthIn(max = 560.dp).fillMaxWidth(), onClose = actions.close, bodyPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
        LazyColumn(
          Modifier.fillMaxWidth().weight(1f, fill = false),
          contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          item {
            GroupBox {
              Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                  Text("Guard", style = MaterialTheme.typography.titleMedium)
                  Text(
                    when {
                      !ready -> "Allow the two permissions below and Tubby can step in."
                      state.guardEnabled -> "On. Opening a guarded app brings up the block screen."
                      else -> "Paused. Nothing gets blocked until you turn it back on."
                    },
                    style = MaterialTheme.typography.bodySmall,
                  )
                }
                Spacer(Modifier.width(12.dp))
                AquaCheck(state.guardEnabled && ready, onChange = if (ready) actions.setGuard else null, label = "Phone guard on")
              }
            }
          }
          item {
            GroupBox {
              Text("Permissions", style = MaterialTheme.typography.titleMedium)
              Spacer(Modifier.height(4.dp))
              Perm.entries.forEachIndexed { i, p ->
                val ok = perms[p] == true
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                  StepDot(i + 1, ok)
                  Spacer(Modifier.width(12.dp))
                  Column(Modifier.weight(1f)) {
                    Text(p.title + if (p.required) "" else " (recommended)", style = MaterialTheme.typography.labelLarge)
                    Text(p.why, style = MaterialTheme.typography.bodySmall)
                  }
                  if (!ok) {
                    Spacer(Modifier.width(10.dp))
                    val ask = p == Perm.NOTIFICATIONS && notificationsAsk
                    GelButton(if (ask) "Allow" else "Open", { actions.openPerm(p) }, kind = if (p.required) GelKind.Default else GelKind.Secondary)
                  }
                }
              }
            }
          }
          item {
            GroupBox {
              Text("Guarded apps", style = MaterialTheme.typography.titleMedium)
              Text(
                "${state.blockedApps.size} picked. They're shared with the web and Windows apps as your guarded list.",
                style = MaterialTheme.typography.bodySmall,
              )
              Spacer(Modifier.height(10.dp))
              AquaField(query, { query = it }, placeholder = "Search apps")
              Spacer(Modifier.height(10.dp))
              FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PickChip("All", category == null, { category = null })
                categories.forEach { c -> PickChip(c.label, category == c, { category = if (category == c) null else c }) }
              }
            }
          }
          if (apps == null) {
            item { Text("Looking at your apps…", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 4.dp)) }
          } else if (visible.isEmpty()) {
            item { Text("No apps match that.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 4.dp)) }
          } else {
            items(visible, key = { it.pkg }) { app ->
              val on = app.pkg in state.blockedPkgs
              Row(
                Modifier.fillMaxWidth()
                  .background(Color(0x99FFFFFF), androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                  .clickable { actions.toggleApp(app) }
                  .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                AppTile(app.label, 36.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                  Text(app.label, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                  Text(app.category.label + if (app.suggested) " · common time sink" else "", style = MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                AquaCheck(on, { actions.toggleApp(app) }, label = "Guard ${app.label}")
              }
            }
          }
          item {
            GroupBox {
              Text("Try it", style = MaterialTheme.typography.titleMedium)
              Text("See exactly what shows up over a guarded app. Nothing is burned in the preview.", style = MaterialTheme.typography.bodySmall)
              Spacer(Modifier.height(10.dp))
              GelButton("Preview the block screen", actions.preview, kind = GelKind.Secondary, enabled = perms[Perm.OVERLAY] == true)
            }
          }
          item {
            GroupBox {
              Text("Server", style = MaterialTheme.typography.titleMedium)
              Text("Where this phone keeps your points and loads its screens.", style = MaterialTheme.typography.bodySmall)
              Spacer(Modifier.height(8.dp))
              AquaField(url, { url = it; serverNote = null }, placeholder = "https://…")
              Spacer(Modifier.height(8.dp))
              Row(verticalAlignment = Alignment.CenterVertically) {
                GelButton("Save and test", {
                  scope.launch {
                    serverNote = actions.saveServer(url)
                  }
                }, kind = GelKind.Secondary)
                Spacer(Modifier.width(10.dp))
                serverNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
              }
            }
          }
        }
        Box(Modifier.fillMaxWidth().padding(14.dp), contentAlignment = Alignment.CenterEnd) {
          GelButton("Done", actions.close, large = true, throb = ready && state.blockedApps.isNotEmpty())
        }
      }
    }
  }
}

@Composable
private fun StepDot(n: Int, ok: Boolean) {
  Box(
    Modifier.size(30.dp).background(
      if (ok) Brush.verticalGradient(listOf(Color(0xFF7FD69A), BurnColors.Good)) else Brush.verticalGradient(listOf(Color.White, Color(0xFFE1E4E8))),
      CircleShape,
    ),
    contentAlignment = Alignment.Center,
  ) {
    Text(if (ok) "✓" else "$n", style = MaterialTheme.typography.labelMedium.copy(color = if (ok) Color.White else BurnColors.AccentDeep, fontWeight = FontWeight.Bold))
  }
}
