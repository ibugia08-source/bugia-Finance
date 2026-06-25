import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { limiteUsado, limiteDisponivel } from "@/lib/services/calculations";
import { invoiceReferenceFor } from "@/lib/services/invoices";
import { InvoiceImportDialog } from "../invoice-import-dialog";
import { ResponsibleSelect } from "./responsible-select";
import { CardDetailFilters } from "./month-filter";
import { AccountCardsSection } from "./account-cards-section";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth/viewer";

type Search = {
  mes?: string;
  pessoa?: string;
  categoria?: string;
  status?: string;
};

function statusVariant(status: string): any {
  switch (status) {
    case "pago":
      return "success";
    case "devendo":
      return "destructive";
    case "reembolsado":
      return "secondary";
    case "cancelado":
      return "outline";
    default:
      return "warning";
  }
}

function invoiceStatusVariant(s: string): any {
  if (s === "paga") return "success";
  if (s === "atrasada") return "destructive";
  if (s === "parcial") return "warning";
  return "secondary";
}

function bestPurchaseDay(closingDay: number) {
  // Compras feitas após o fechamento entram na próxima fatura -> melhor dia = closingDay + 1
  const d = closingDay + 1;
  return d > 31 ? 1 : d;
}

export default async function CardDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Search;
}) {
  await requireAdmin();
  const card = await prisma.creditCard.findUnique({
    where: { id: params.id },
    include: {
      holder: true,
      account: true,
      accountCards: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!card) notFound();

  const [people, categories] = await Promise.all([
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Mês selecionado (default = mês atual)
  let ref = new Date();
  if (searchParams.mes) {
    const [y, m] = searchParams.mes.split("-").map(Number);
    if (y && m) ref = new Date(y, m - 1, 1);
  }
  const { start, end } = monthRange(ref);

  const refInvoice = invoiceReferenceFor(start, card.closingDay);

  const txWhere: any = {
    cardId: card.id,
    date: { gte: start, lt: end },
  };
  if (searchParams.pessoa) txWhere.responsibleId = searchParams.pessoa;
  if (searchParams.categoria) txWhere.categoryId = searchParams.categoria;
  if (searchParams.status) txWhere.status = searchParams.status;

  const [
    used,
    available,
    invoices,
    transactions,
    nextDueInvoice,
    futureInstAgg,
  ] = await Promise.all([
    limiteUsado(card.id),
    limiteDisponivel(card.id),
    prisma.creditCardInvoice.findMany({
      where: { cardId: card.id },
      orderBy: [{ referenceYear: "desc" }, { referenceMonth: "desc" }],
      take: 12,
    }),
    prisma.transaction.findMany({
      where: txWhere,
      orderBy: { date: "desc" },
      include: { category: true, responsible: true },
    }),
    prisma.creditCardInvoice.findFirst({
      where: { cardId: card.id, status: { in: ["aberta", "fechada", "parcial", "atrasada"] } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.installment.aggregate({
      where: { transaction: { cardId: card.id }, paid: false, dueDate: { gte: new Date() } },
      _sum: { amount: true },
    }),
  ]);

  const currentInvoice = invoices.find(
    (i) =>
      i.referenceMonth === refInvoice.referenceMonth &&
      i.referenceYear === refInvoice.referenceYear
  );

  // Resumo por pessoa baseado nas transações filtradas (mês selecionado)
  type Summary = {
    personId: string | null;
    name: string;
    total: number;
    pago: number;
    pendente: number;
    devendo: number;
    reembolsavel: number;
  };
  const byPerson = new Map<string, Summary>();
  for (const t of transactions) {
    const key = t.responsibleId ?? "__none__";
    const s = byPerson.get(key) ?? {
      personId: t.responsibleId,
      name: t.responsible?.name ?? "Sem responsável",
      total: 0,
      pago: 0,
      pendente: 0,
      devendo: 0,
      reembolsavel: 0,
    };
    s.total += t.amount;
    if (t.status === "pago") s.pago += t.amount;
    else if (t.status === "devendo") s.devendo += t.amount;
    else if (t.status === "pendente") s.pendente += t.amount;
    if (t.reimbursable) s.reembolsavel += t.amount;
    byPerson.set(key, s);
  }
  const personSummary = Array.from(byPerson.values()).sort((a, b) => b.total - a.total);

  const pct = card.limitTotal > 0 ? (used / card.limitTotal) * 100 : 0;

  return (
    <div>
      <div className="mb-2">
        <Link href="/cartoes" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Voltar para contas bancárias
        </Link>
      </div>
      <PageHeader
        title={card.name}
        description={`${card.bank ?? ""} · Titular: ${card.holder?.name ?? "—"}${card.account ? ` · Conta: ${card.account.name}` : ""}`}
        actions={<InvoiceImportDialog cardId={card.id} cardName={card.name} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Limite total" value={formatBRL(card.limitTotal)} />
        <StatCard title="Limite usado" value={formatBRL(used)} intent="negative" />
        <StatCard title="Limite disponível" value={formatBRL(available)} intent="positive" />
        <StatCard
          title="Parcelas futuras"
          value={formatBRL(futureInstAgg._sum.amount ?? 0)}
        />
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Fechamento</p>
            <p className="text-2xl font-bold mt-1">Dia {card.closingDay}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Melhor dia de compra: {bestPurchaseDay(card.closingDay)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Vencimento</p>
            <p className="text-2xl font-bold mt-1">Dia {card.dueDay}</p>
            {nextDueInvoice && (
              <p className="text-xs text-muted-foreground mt-1">
                Próximo: {formatDateBR(nextDueInvoice.dueDate)} ({formatBRL(nextDueInvoice.total - nextDueInvoice.paid)})
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Fatura do mês</p>
            <p className="text-2xl font-bold mt-1">
              {currentInvoice ? formatBRL(currentInvoice.total) : "—"}
            </p>
            {currentInvoice && (
              <Badge variant={invoiceStatusVariant(currentInvoice.status)} className="mt-1 capitalize">
                {currentInvoice.status}
              </Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Uso do limite</p>
            <p className="text-2xl font-bold mt-1">{pct.toFixed(0)}%</p>
            <Progress value={Math.min(100, pct)} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      <AccountCardsSection cardId={card.id} accountCards={card.accountCards} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Faturas por mês</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referência</TableHead>
                <TableHead>Fechamento</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Sem faturas geradas ainda. Importe transações para criar faturas.
                  </TableCell>
                </TableRow>
              )}
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    {String(inv.referenceMonth).padStart(2, "0")}/{inv.referenceYear}
                  </TableCell>
                  <TableCell>{formatDateBR(inv.closingDate)}</TableCell>
                  <TableCell>{formatDateBR(inv.dueDate)}</TableCell>
                  <TableCell className="text-right">{formatBRL(inv.total)}</TableCell>
                  <TableCell className="text-right">{formatBRL(inv.paid)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatBRL(inv.total - inv.paid)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoiceStatusVariant(inv.status)} className="capitalize">
                      {inv.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="p-4">
          <CardDetailFilters people={people} categories={categories} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Resumo por pessoa (mês selecionado)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pessoa</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Pendente</TableHead>
                <TableHead className="text-right">Devendo</TableHead>
                <TableHead className="text-right">Reembolsável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personSummary.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Sem transações no período selecionado.
                  </TableCell>
                </TableRow>
              )}
              {personSummary.map((s) => (
                <TableRow key={s.personId ?? "none"}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-right">{formatBRL(s.total)}</TableCell>
                  <TableCell className="text-right text-emerald-600">{formatBRL(s.pago)}</TableCell>
                  <TableCell className="text-right">{formatBRL(s.pendente)}</TableCell>
                  <TableCell className="text-right text-red-600">{formatBRL(s.devendo)}</TableCell>
                  <TableCell className="text-right">{formatBRL(s.reembolsavel)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transações do mês</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma transação no mês selecionado.
                  </TableCell>
                </TableRow>
              )}
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{formatDateBR(t.date)}</TableCell>
                  <TableCell className="max-w-xs truncate">{t.description}</TableCell>
                  <TableCell>{t.category?.name ?? "—"}</TableCell>
                  <TableCell className="min-w-[180px]">
                    <ResponsibleSelect txId={t.id} value={t.responsibleId} people={people} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(t.status)} className="capitalize">
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    -{formatBRL(t.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
