package app.burn.focus.domain

/** Two cosmetic slots: fur color and one prop. */
enum class Slot(val title: String) { SKIN("Fur"), ACCESSORY("Props") }

data class Cosmetic(
  val id: String,
  val name: String,
  val slot: Slot,
  val price: Int,
  val blurb: String,
  val emoji: String? = null,
)

object Cosmetics {
  /** Tubby's own look: free and owned from the start. */
  const val DEFAULT_SKIN = "skin_classic"

  val colors: List<Cosmetic> = listOf(
    Cosmetic(DEFAULT_SKIN, "Classic Pink", Slot.SKIN, 0, "Tubby's original fur"),
    Cosmetic("skin_mint", "Mint", Slot.SKIN, 80, "Cool, calm, collected"),
    Cosmetic("skin_ocean", "Ocean", Slot.SKIN, 80, "Deep focus blue"),
    Cosmetic("skin_grape", "Grape", Slot.SKIN, 120, "Sweet with a little attitude"),
    Cosmetic("skin_sunset", "Sunset", Slot.SKIN, 150, "Golden-hour walks, not feeds"),
    Cosmetic("skin_midnight", "Midnight", Slot.SKIN, 250, "Quiet nights, phone in a drawer"),
    Cosmetic("skin_gold", "Gold", Slot.SKIN, 400, "For the truly disciplined"),
  )

  val accessories: List<Cosmetic> = listOf(
    Cosmetic("acc-bow", "Velvet Bow", Slot.ACCESSORY, 150, "A little flourish behind the ear", "🎀"),
    Cosmetic("acc-glasses", "Star Shades", Slot.ACCESSORY, 180, "For looking unbothered", "🕶️"),
    Cosmetic("acc-scarf", "Cozy Scarf", Slot.ACCESSORY, 220, "Warm neck, cold turkey", "🧣"),
    Cosmetic("acc-flowers", "Daisy Crown", Slot.ACCESSORY, 240, "A meadow on your head", "🌼"),
    Cosmetic("acc-headphones", "Beat Headphones", Slot.ACCESSORY, 260, "Your focus soundtrack", "🎧"),
    Cosmetic("acc-crown", "Sunbeam Crown", Slot.ACCESSORY, 320, "For a reigning streak", "👑"),
  )

  val all: List<Cosmetic> = colors + accessories

  fun byId(id: String?): Cosmetic? = all.firstOrNull { it.id == id }

  /** The equipped fur, falling back to Classic for unknown or retired ids. */
  fun skinOf(id: String?): String = byId(id)?.takeIf { it.slot == Slot.SKIN }?.id ?: DEFAULT_SKIN

  fun accessoryOf(id: String?): String? = byId(id)?.takeIf { it.slot == Slot.ACCESSORY }?.id

  /** Backend uses color-*; the Android frames are named skin_*. */
  fun serverId(localId: String): String = if (localId.startsWith("skin_")) "color-" + localId.removePrefix("skin_") else localId

  fun localId(serverId: String): String = if (serverId.startsWith("color-")) "skin_" + serverId.removePrefix("color-") else serverId

  fun slotFor(localId: String): Slots = if (byId(localId)?.slot == Slot.ACCESSORY) Slots.ACCESSORY else Slots.COLOR

  enum class Slots(val api: String) { COLOR("color"), ACCESSORY("accessory") }

  /** Price list kept in sync with backend/src/seed.ts. */
  fun priceOf(localId: String): Int = byId(localId)?.price ?: Int.MAX_VALUE
}
