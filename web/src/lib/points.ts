/** Cost of one slip, the same rule the server uses: 25% of the balance (10–150), doubled in hard mode, never more than the balance. */
export function slipCost(balance: number, hard: boolean): number {
  if (balance <= 0) return 0;
  const base = Math.min(150, Math.max(10, Math.round(balance * 0.25)));
  return Math.min(balance, hard ? base * 2 : base);
}
