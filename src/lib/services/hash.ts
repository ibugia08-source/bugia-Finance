import { createHash } from "crypto";

export function transactionHash(input: {
  date: Date | string;
  description: string;
  amount: number;
  cardId?: string | null;
  accountId?: string | null;
}) {
  const d = typeof input.date === "string" ? new Date(input.date) : input.date;
  const day = d.toISOString().slice(0, 10);
  const desc = (input.description || "").trim().toUpperCase();
  const amt = Math.round(input.amount * 100);
  const key = `${day}|${desc}|${amt}|${input.cardId ?? ""}|${input.accountId ?? ""}`;
  return createHash("sha1").update(key).digest("hex");
}
