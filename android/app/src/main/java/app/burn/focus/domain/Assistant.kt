package app.burn.focus.domain

import kotlinx.serialization.Serializable

/** Coach preferences, mirrored from GET/PUT /api/assistant/settings. */
@Serializable
data class CoachSettings(
  val tone: String = "warm",
  val brevity: String = "short",
  val nudges: String = "sometimes",
  val voice: Boolean = true,
) {
  val toneLabel: String get() = tone.replaceFirstChar { it.uppercase() }
}

@Serializable
data class ChatMessage(
  val role: String, // "user" | "assistant"
  val content: String,
  val at: Long = System.currentTimeMillis(),
)

data class ChatReply(val text: String, val mood: String, val mode: String)

/** Server-side achievement rows (11 in the current backend). */
@Serializable
data class ServerAchievement(
  val id: String,
  val name: String,
  val emoji: String = "★",
  val description: String,
  val unlocked: Boolean,
  val progress: Float = 0f,
  val detail: String = "",
)
