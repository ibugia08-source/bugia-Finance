import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/format";

export async function totalDespesasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const result = await prisma.transaction.aggregate({
    where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function totalReceitasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const tx = await prisma.transaction.aggregate({
    where: { type: "receita", date: { gte: start, lt: end }, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  // Considera apenas receitas efetivamente recebidas no mês
  const inc = await prisma.income.aggregate({
    where: { receivedAt: { gte: start, lt: end }, status: "RECEIVED" },
    _sum: { amount: true },
  });
  return (tx._sum.amount ?? 0) + (inc._sum.amount ?? 0);
}

export async function receitasPrevistasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const inc = await prisma.income.aggregate({
    where: {
      receivedAt: { gte: start, lt: end },
      status: { in: ["EXPECTED", "LATE"] },
    },
    _sum: { amount: true },
  });
  return inc._sum.amount ?? 0;
}

export async function despesasPrevistasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      type: "despesa",
      date: { gte: start, lt: end },
      status: { in: ["pendente", "devendo"] },
    },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function despesasPagasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      type: "despesa",
      date: { gte: start, lt: end },
      status: "pago",
    },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function faturasPagasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.creditCardInvoice.aggregate({
    where: { status: "paga", dueDate: { gte: start, lt: end } },
    _sum: { paid: true },
  });
  return r._sum.paid ?? 0;
}

export async function totalEmCaixa() {
  const r = await prisma.cashBox.aggregate({ _sum: { currentAmount: true } });
  return r._sum.currentAmount ?? 0;
}

export async function totalReservaEmergencia() {
  const r = await prisma.cashBox.aggregate({
    where: { type: "EMERGENCY" },
    _sum: { currentAmount: true },
  });
  return r._sum.currentAmount ?? 0;
}

export async function taxaEndividamento(reference: Date = new Date()) {
  const receitas = await totalReceitasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  const desp = await despesasPrevistasMes(reference);
  const obrig = faturas.openAmount + desp;
  if (receitas <= 0) return obrig > 0 ? 1 : 0;
  return obrig / receitas;
}

export async function sobraReal(reference: Date = new Date()) {
  const receitasRecebidas = await totalReceitasMes(reference);
  const despesasPagas = await despesasPagasMes(reference);
  const faturasPagas = await faturasPagasMes(reference);
  return receitasRecebidas - despesasPagas - faturasPagas;
}

export async function saldoPrevistoCompleto(reference: Date = new Date()) {
  const recRec = await totalReceitasMes(reference);
  const recPrev = await receitasPrevistasMes(reference);
  const aReceber = await totalAReceber();
  const desp = await despesasPrevistasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  return recRec + recPrev + aReceber - desp - faturas.openAmount;
}

export async function comprometimentoFaturas(reference: Date = new Date()) {
  const receitas = await totalReceitasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  if (receitas <= 0) return faturas.openAmount > 0 ? 1 : 0;
  return faturas.openAmount / receitas;
}

export async function nivelReserva(reference: Date = new Date()) {
  const caixa = await totalEmCaixa();
  const desp = await totalDespesasMes(reference);
  if (desp <= 0) return { meses: caixa > 0 ? Infinity : 0, classificacao: caixa > 0 ? "Forte" : "Sem reserva" };
  const meses = caixa / desp;
  let classificacao: "Sem reserva" | "Baixa" | "Boa" | "Forte" = "Sem reserva";
  if (meses >= 6) classificacao = "Forte";
  else if (meses >= 3) classificacao = "Boa";
  else if (meses > 0) classificacao = "Baixa";
  return { meses, classificacao };
}

export async function saldoPrevistoMes(reference: Date = new Date()) {
  const r = await totalReceitasMes(reference);
  const d = await totalDespesasMes(reference);
  return r - d;
}

export async function totalPorPessoa() {
  const rows = await prisma.transaction.groupBy({
    by: ["responsibleId"],
    _sum: { amount: true },
    where: { status: { not: "cancelado" }, type: "despesa" },
  });
  const people = await prisma.person.findMany();
  return rows.map((r) => ({
    personId: r.responsibleId,
    name: people.find((p) => p.id === r.responsibleId)?.name ?? "Sem responsável",
    total: r._sum.amount ?? 0,
  }));
}

export async function totalPorCartao() {
  const rows = await prisma.transaction.groupBy({
    by: ["cardId"],
    _sum: { amount: true },
    where: { status: { not: "cancelado" }, type: "despesa", cardId: { not: null } },
  });
  const cards = await prisma.creditCard.findMany();
  return rows.map((r) => ({
    cardId: r.cardId,
    name: cards.find((c) => c.id === r.cardId)?.name ?? "?",
    total: r._sum.amount ?? 0,
  }));
}

export async function totalAReceber() {
  const r = await prisma.receivable.aggregate({
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function totalFaturas(status?: string[]) {
  const r = await prisma.creditCardInvoice.aggregate({
    where: status ? { status: { in: status } } : undefined,
    _sum: { total: true, paid: true },
  });
  const total = r._sum.total ?? 0;
  const paid = r._sum.paid ?? 0;
  return { total, paid, openAmount: total - paid };
}

export async function limiteDisponivel(cardId: string) {
  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) return 0;
  const inv = await prisma.creditCardInvoice.aggregate({
    where: { cardId, status: { in: ["aberta", "fechada", "parcial"] } },
    _sum: { total: true, paid: true },
  });
  const used = (inv._sum.total ?? 0) - (inv._sum.paid ?? 0);
  return Math.max(0, card.limitTotal - used);
}

export async function limiteUsado(cardId: string) {
  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) return 0;
  const inv = await prisma.creditCardInvoice.aggregate({
    where: { cardId, status: { in: ["aberta", "fechada", "parcial"] } },
    _sum: { total: true, paid: true },
  });
  return Math.max(0, (inv._sum.total ?? 0) - (inv._sum.paid ?? 0));
}

export async function parcelasFuturas() {
  const today = new Date();
  return prisma.installment.findMany({
    where: { paid: false, dueDate: { gte: today } },
    orderBy: { dueDate: "asc" },
    include: { transaction: { include: { card: true } } },
  });
}

export async function progressoMeta(goalId: string) {
  const g = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!g) return 0;
  if (g.targetAmount <= 0) return 0;
  return Math.min(100, (g.currentAmount / g.targetAmount) * 100);
}

export async function gastosPorPertenceA(belongsTo: string, reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      belongsTo,
      type: "despesa",
      date: { gte: start, lt: end },
      status: { not: "cancelado" },
    },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function quemMeDeve() {
  const rows = await prisma.receivable.groupBy({
    by: ["personId"],
    _sum: { amount: true },
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
  });
  const people = await prisma.person.findMany();
  return rows.map((r) => ({
    personId: r.personId,
    name: people.find((p) => p.id === r.personId)?.name ?? "?",
    total: r._sum.amount ?? 0,
  }));
}
