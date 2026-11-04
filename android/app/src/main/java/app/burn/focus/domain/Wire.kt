package app.burn.focus.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

data class Offer(
  val id: String,
  val business: String,
  val title: String,
  val description: String,
  val category: String,
  val discountPercent: Int,
  val pointsPrice: Int,
  val terms: String,
  val imageUrl: String?,
  val monthlyCap: Int?,
  val redeemedThisMonth: Int?,
)

data class MeSnapshot(
  val balance: Int,
  val streak: Int?,
  val bestStreak: Int?,
  val owned: Set<String> = emptySet(),
  val equipped: Map<String, String> = emptyMap(),
  val achievements: List<ServerAchievement> = emptyList(),
  /** Server difficulty ("hard" doubles slips). */
  val hardMode: Boolean = false,
)

/** Tolerant parsers for the backend JSON (see backend/src/routes). */
object Wire {
  val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; isLenient = true }

  private fun JsonObject.str(vararg keys: String): String? = keys.firstNotNullOfOrNull { k ->
    (this[k] as? JsonPrimitive)?.takeIf { it.isString || it.intOrNull != null }?.content
  }
  private fun JsonObject.int(vararg keys: String): Int? = keys.firstNotNullOfOrNull { k ->
    (this[k] as? JsonPrimitive)?.let { it.intOrNull ?: it.content.toDoubleOrNull()?.toInt() }
  }
  private fun JsonElement?.obj(): JsonObject? = this as? JsonObject

  fun parse(text: String): JsonElement? = runCatching { json.parseToJsonElement(text) }.getOrNull()

  /** "myapp.ngrok.app/api/" -> "http://myapp.ngrok.app"; null when blank or unusable. */
  fun normalizeBaseUrl(raw: String): String? {
    var u = raw.trim().trimEnd('/')
    if (u.isEmpty()) return null
    if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://$u"
    u = u.removeSuffix("/api").trimEnd('/')
    val host = u.substringAfter("://").substringBefore('/').substringBefore(':')
    if (host.isBlank() || host.contains(' ')) return null
    return u
  }

  fun absoluteUrl(base: String, url: String?): String? = when {
    url.isNullOrBlank() -> null
    url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") -> url
    url.startsWith("/") -> base.trimEnd('/') + url
    else -> base.trimEnd('/') + "/" + url
  }

  fun offers(root: JsonElement?, base: String = ""): List<Offer> {
    val arr = when (root) {
      is JsonArray -> root
      is JsonObject -> root["offers"] as? JsonArray ?: return emptyList()
      else -> return emptyList()
    }
    return arr.mapNotNull { el ->
      val o = el.obj() ?: return@mapNotNull null
      val id = o.str("id") ?: return@mapNotNull null
      Offer(
        id = id,
        business = o.str("business", "merchant", "merchantName") ?: "Local spot",
        title = o.str("title", "offerTitle") ?: "Reward",
        description = o.str("description") ?: "",
        category = o.str("category") ?: "other",
        discountPercent = o.int("discountPercent", "discount_percent") ?: 0,
        pointsPrice = o.int("pointsPrice", "points_price", "points") ?: 0,
        terms = o.str("terms") ?: "",
        imageUrl = absoluteUrl(base, o.str("imageUrl", "image_url")),
        monthlyCap = o.int("monthlyCap"),
        redeemedThisMonth = o.int("redeemedThisMonth"),
      )
    }
  }

  fun me(root: JsonElement?): MeSnapshot? {
    val o = root.obj() ?: return null
    val bal = o.int("balance") ?: return null
    val owned = (o["ownedCosmetics"] as? JsonArray)?.mapNotNull { el ->
      (el as? JsonObject)?.str("id")?.let(Cosmetics::localId)?.takeIf { Cosmetics.byId(it) != null }
    }?.toSet() ?: emptySet()
    val equipped = buildMap {
      val eq = o["equipped"] as? JsonObject ?: return@buildMap
      (eq["color"] as? JsonPrimitive)?.content?.let { put(Slot.SKIN.name, Cosmetics.localId(it)) }
      (eq["accessory"] as? JsonPrimitive)?.content?.let { put(Slot.ACCESSORY.name, Cosmetics.localId(it)) }
    }
    val achievements = (o["achievements"] as? JsonArray)?.mapNotNull { el ->
      val a = el as? JsonObject ?: return@mapNotNull null
      val id = a.str("id") ?: return@mapNotNull null
      ServerAchievement(
        id = id,
        name = a.str("name") ?: id,
        emoji = a.str("emoji") ?: "★",
        description = a.str("description") ?: "",
        unlocked = (a["unlocked"] as? JsonPrimitive)?.content == "true",
        progress = ((a["progress"] as? JsonPrimitive)?.content?.toFloatOrNull() ?: 0f).coerceIn(0f, 1f),
        detail = a.str("detail") ?: "",
      )
    } ?: emptyList()
    return MeSnapshot(bal, o.int("streak"), o.int("bestStreak"), owned, equipped, achievements, hardMode = o.str("difficulty") == "hard")
  }

  /** GET/PUT /api/assistant/settings -> { settings:{tone,brevity,nudges,goals,apps} }. */
  fun coachSettings(root: JsonElement?): CoachSettings? {
    val s = (root.obj()?.get("settings") as? JsonObject) ?: return null
    return CoachSettings(
      tone = s.str("tone") ?: "warm",
      brevity = s.str("brevity") ?: "short",
      nudges = s.str("nudges") ?: "sometimes",
    )
  }

  fun chatReply(root: JsonElement?): ChatReply? {
    val o = root.obj() ?: return null
    val text = o.str("reply") ?: return null
    return ChatReply(text, o.str("mood") ?: "neutral", o.str("mode") ?: "live")
  }

  fun hello(root: JsonElement?): String? = root.obj()?.str("message")

  fun goals(root: JsonElement?): List<String> {
    val s = (root.obj()?.get("settings") as? JsonObject) ?: return emptyList()
    return (s["goals"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
  }

  /** POST /api/offers/:id/redeem -> { redemption:{id,code,...}, qrPayload, qrDataUrl, balance } */
  fun redemption(root: JsonElement?, offer: Offer, now: Long): Pair<Redemption, Int?>? {
    val o = root.obj() ?: return null
    val r = o["redemption"].obj() ?: o
    val code = r.str("code") ?: return null
    val red = Redemption(
      id = r.str("id") ?: "red-$now",
      offerId = r.str("offerId") ?: offer.id,
      title = r.str("title") ?: offer.title,
      business = r.str("business") ?: offer.business,
      code = code,
      points = r.int("points") ?: offer.pointsPrice,
      at = now,
      qrDataUrl = o.str("qrDataUrl")?.takeIf { it.startsWith("data:image") },
    )
    return red to o.int("balance")
  }

  /**
   * POST /api/nudges/batch -> { nudges:[{id, template, tone, preview}] }. Server templates use
   * {points} for points at risk; our renderer calls that {risk}.
   */
  fun nudgeBatch(root: JsonElement?, appPkg: String): List<Nudge> {
    val arr = root.obj()?.get("nudges") as? JsonArray ?: return emptyList()
    return arr.mapNotNull { el ->
      val o = el.obj() ?: return@mapNotNull null
      val t = (o.str("template", "text", "nudge") ?: return@mapNotNull null).trim()
      if (t.isEmpty() || t.length > 240) return@mapNotNull null
      Nudge(
        id = "srv-" + (o.str("id") ?: t.hashCode().toString()),
        text = t.replace("{points}", "{risk}"),
        app = appPkg,
        tone = o.str("tone"),
        source = "muse",
      )
    }
  }

  fun errorMessage(root: JsonElement?): String? = root.obj()?.str("error", "message")

  fun isNull(e: JsonElement?) = e == null || e is JsonNull
}

object MockOffers {
  val all = listOf(
    Offer("mock-coffee", "Corner Bean Café", "Free drip coffee", "Any size drip coffee or tea, on the house.", "cafe", 100, 150, "One per visit. Dine in or to go.", null, 50, 3),
    Offer("mock-climb", "Boulder Barn", "Half-price day pass", "50% off a climbing day pass, shoes included.", "fitness", 50, 600, "Weekdays only. Waiver required.", null, 30, 8),
    Offer("mock-yoga", "Sunrise Yoga Loft", "First class free", "Drop into any beginner flow class.", "fitness", 100, 400, "New students only.", null, 20, 2),
    Offer("mock-books", "Paper Trail Books", "20% off one book", "Swap a scroll for a story.", "retail", 20, 250, "Excludes gift cards.", null, 40, 5),
    Offer("mock-pizza", "Slice Society", "2-for-1 slices", "Bring a friend, buy one slice and get one free.", "food", 50, 300, "Dine in, after 3 PM.", null, 60, 12),
  )
}
