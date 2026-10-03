// Late fee in cents: 25 cents a day after a 2 day grace period, capped at 500.
export function lateFee(days) {
  return Math.min(500, Math.max(0, days - 2) * 25);
}
