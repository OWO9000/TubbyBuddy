package app.burn.focus.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.burn.focus.R

/** The same tokens as the web theme (theme.css): Aqua windows over a light-blue paper valley. */
object BurnColors {
  val Text = Color(0xFF1D2128)
  val Title = Color(0xFF2A2D33)
  val Muted = Color(0xFF5D6673)
  val Accent = Color(0xFF2F7DE0)
  val AccentDeep = Color(0xFF2A6FD0)
  val Edge = Color(0xFF1C5FB8)
  val Good = Color(0xFF23864F)
  val Bad = Color(0xFFD23A30)
  val Gold = Color(0xFFF4A621)
  val GroupLine = Color(0xFFC1C6CD)
  val Stripe1 = Color(0xFFF4F6F9)
  val Stripe2 = Color(0xFFE9ECF0)
  val Sky = Color(0xFFACE0FB)

  // Names some older code still uses.
  val Mint = Good
  val Ember = Accent
}

val Fira = FontFamily(
  Font(R.font.fira_sans_regular, FontWeight.Normal),
  Font(R.font.fira_sans_semibold, FontWeight.SemiBold),
  Font(R.font.fira_sans_bold, FontWeight.Bold),
)

private val scheme = lightColorScheme(
  primary = BurnColors.Accent,
  onPrimary = Color.White,
  secondary = BurnColors.AccentDeep,
  background = BurnColors.Sky,
  onBackground = BurnColors.Text,
  surface = Color.White,
  onSurface = BurnColors.Text,
  onSurfaceVariant = BurnColors.Muted,
  outline = BurnColors.GroupLine,
  error = BurnColors.Bad,
)

private fun t(size: Int, weight: FontWeight = FontWeight.Normal, color: Color = BurnColors.Text, line: Int = (size * 1.4f).toInt()) =
  TextStyle(fontFamily = Fira, fontSize = size.sp, fontWeight = weight, color = color, lineHeight = line.sp, letterSpacing = 0.sp)

private val type = Typography(
  displaySmall = t(34, FontWeight.Bold, line = 40),
  headlineMedium = t(26, FontWeight.Bold, line = 32),
  headlineSmall = t(22, FontWeight.Bold, line = 28),
  titleLarge = t(19, FontWeight.Bold, line = 25),
  titleMedium = t(15, FontWeight.SemiBold, line = 20),
  titleSmall = t(13, FontWeight.SemiBold, BurnColors.Title, line = 17),
  bodyLarge = t(16),
  bodyMedium = t(14),
  bodySmall = t(12, color = BurnColors.Muted, line = 17),
  labelLarge = t(15, FontWeight.SemiBold),
  labelMedium = t(13, FontWeight.SemiBold),
  labelSmall = t(11, FontWeight.SemiBold, BurnColors.Muted),
)

@Composable
fun BurnTheme(content: @Composable () -> Unit) {
  MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
