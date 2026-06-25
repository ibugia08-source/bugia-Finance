import { prisma } from "@/lib/prisma";

/**
 * Determina mês/ano de fatura para uma compra em `date` num cartão com closingDay.
 * Se a data de compra é >= closingDay, vai para a próxima fatura.
 */
export function invoiceReferenceFor(date: Date, closingDay: number) {
  const d = new Date(date);
  let year = d.getFullYear();
  let month = d.getMonth() + 1; // 1-12
  if (d.getDate() >= closingDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { referenceMonth: month, referenceYear: year };
}

export async function ensureInvoice(cardId: string, refMonth: number, refYear: number) {
  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) throw new Error("Cartão não encontrado");

  const existing = await prisma.creditCardInvoice.findUnique({
    where: {
      cardId_referenceYear_referenceMonth: {
        cardId,
        referenceYear: refYear,
        referenceMonth: refMonth,
      },
    },
  });
  if (existing) return existing;

  const closingDate = new Date(refYear, refMonth - 1, card.closingDay);
  const dueDate = new Date(refYear, refMonth - 1, card.dueDay);

  return prisma.creditCardInvoice.create({
    data: {
      cardId,
      referenceMonth: refMonth,
      referenceYear: refYear,
      closingDate,
      dueDate,
      total: 0,
      paid: 0,
      status: "aberta",
    },
  });
}

export async function recalcInvoiceTotal(invoiceId: string) {
  const result = await prisma.transaction.aggregate({
    where: { invoiceId, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  await prisma.creditCardInvoice.update({
    where: { id: invoiceId },
    data: { total: result._sum.amount ?? 0 },
  });
}

export async function attachToInvoice(transactionId: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || !tx.cardId) return null;
  const card = await prisma.creditCard.findUnique({ where: { id: tx.cardId } });
  if (!card) return null;
  const ref = invoiceReferenceFor(tx.date, card.closingDay);
  const inv = await ensureInvoice(card.id, ref.referenceMonth, ref.referenceYear);
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { invoiceId: inv.id },
  });
  await recalcInvoiceTotal(inv.id);
  return inv;
}
