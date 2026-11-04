package app.burn.focus.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerTest {
  private fun e(id: String, kind: EntryKind, amt: Int, synced: Boolean = false, local: Boolean = false) =
    LedgerEntry(id, kind, amt, "r", 0L, synced = synced, localOnly = local)

  private fun LedgerState.plus(entry: LedgerEntry) = (Ledger.append(this, entry) as LedgerResult.Ok).state

  @Test fun balanceSumsSignedEntries() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15)).plus(e("2", EntryKind.BONUS, 20)).plus(e("3", EntryKind.BURN, 10))
    assertEquals(25, s.balance)
  }

  @Test fun spendBeyondBalanceIsRejected() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15))
    assertTrue(Ledger.append(s, e("2", EntryKind.SPEND, 16)) is LedgerResult.Rejected)
    assertTrue(Ledger.append(s, e("3", EntryKind.REDEEM, 16)) is LedgerResult.Rejected)
  }

  @Test fun burnIsClampedToBalance() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15))
    val r = Ledger.append(s, e("2", EntryKind.BURN, 100)) as LedgerResult.Ok
    assertEquals(15, r.entry.amount)
    assertEquals(0, r.state.balance)
  }

  @Test fun duplicateIdsAndNegativeAmountsRejected() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15))
    assertTrue(Ledger.append(s, e("1", EntryKind.EARN, 15)) is LedgerResult.Rejected)
    assertTrue(Ledger.append(s, e("x", EntryKind.EARN, -5)) is LedgerResult.Rejected)
  }

  @Test fun compactionKeepsBalanceAndUnsyncedEntries() {
    var s = LedgerState()
    repeat(10) { s = s.plus(e("s$it", EntryKind.EARN, 1, synced = true)) }
    s = s.plus(e("pending", EntryKind.EARN, 5))
    val c = Ledger.compact(s, max = 3)
    assertEquals(s.balance, c.balance)
    assertTrue(c.entries.size <= 3)
    assertTrue(c.entries.any { it.id == "pending" })
  }

  @Test fun markSyncedRemovesFromPending() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15)).plus(e("2", EntryKind.SPEND, 5, local = true))
    assertEquals(listOf("1"), s.pending().map { it.id })
    assertTrue(Ledger.markSynced(s, listOf("1")).pending().isEmpty())
  }

  @Test fun rebaseAdoptsServerBalanceButKeepsLocalOnlySpends() {
    var s = LedgerState().plus(e("1", EntryKind.EARN, 100, synced = true)).plus(e("2", EntryKind.SPEND, 40, local = true))
    assertEquals(60, s.balance)
    s = Ledger.rebase(s, serverBalance = 600) // e.g. demo grant on the server
    assertEquals(560, s.balance)
    // still correct after the local-only entry is compacted away
    val c = Ledger.compact(s.copy(entries = s.entries), max = 0)
    assertEquals(560, Ledger.rebase(c, 600).balance)
  }

  @Test fun rebaseWaitsForPendingEntries() {
    val s = LedgerState().plus(e("1", EntryKind.EARN, 15))
    assertEquals(s, Ledger.rebase(s, 999))
  }

  @Test fun burnAmountRules() {
    assertEquals(0, PointsRules.burnAmount(0))
    assertEquals(5, PointsRules.burnAmount(5))        // never more than you have
    assertEquals(10, PointsRules.burnAmount(20))      // minimum
    assertEquals(50, PointsRules.burnAmount(200))     // 25%
    assertEquals(150, PointsRules.burnAmount(10_000)) // cap
    assertEquals(100, PointsRules.burnAmount(200, hard = true))    // hard mode doubles
    assertEquals(300, PointsRules.burnAmount(10_000, hard = true)) // doubled cap
    assertEquals(15, PointsRules.burnAmount(15, hard = true))      // still never more than you have
  }
}
