import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthLabel, monthRange } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BugiaAvatar } from "@/components/mascot";
import { ArrowRight } from "lucide-react";

export async function UserDashboard({ personId, name }: { personId: string; name: string }) {
  const ref = new Date();
  const { start, end } = monthRange(ref);

  const [txMes, txTotal, openReceivables, paidReceivables, payments, recentTx] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        responsibleId: personId,
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { responsibleId: personId, type: "despesa", status: { not: "cancelado" } },
      _sum: { amount: true },
    }),
    prisma.receivable.aggregate({
      where: { personId, status: { in: ["aberto", "atrasado", "renegociado"] } },
      _sum: { amount: true },
    }),
    prisma.receivable.aggregate({
      where: { personId, status: "pago" },
      _sum: { amount: true },
    }),
    prisma.personPayment.aggregate({
      where: { personId },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { responsibleId: personId, status: { not: "cancelado" } },
      orderBy: { date: "desc" },
      take: 8,
      include: { card: true, account: true, category: true },
    }),
  ]);

  const totalMes = txMes._sum.amount ?? 0;
  const totalGeral = txTotal._sum.amount ?? 0;
  const devendo = openReceivables._sum.amount ?? 0;
  const pago = (paidReceivables._sum.amount ?? 0) + (payments._sum.amount ?? 0);

  return (
    <div>
      <PageHeader
        title={`Olá, ${name.split(" ")[0]}`}
        description={`Resumo de ${monthLabel(ref)}`}
        actions={
          <div className="hidden md:flex items-center gap-3 rounded-xl border bg-card px-3 py-2 ring-gold">
            <BugiaAvatar size={44} />
            <div>
              <p className="text-xs text-muted-foreground">Bem-vindo de volta</p>
              <p className="text-sm font-semibold">Seu painel pessoal</p>
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Gasto no mês" value={formatBRL(totalMes)} intent="negative" />
        <StatCard title="Gasto total" value={formatBRL(totalGeral)} />
        <StatCard title="Em aberto (devendo)" value={formatBRL(devendo)} intent="warning" />
        <StatCard title="Já pago" value={formatBRL(pago)} intent="positive" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Suas movimentações recentes</CardTitle>
          <Link href={`/pessoas/${personId}`}>
            <Button size="sm" variant="outline">
              Ver detalhes <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentTx.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentTx.map((t) => (
                <li key={t.id} className="flex items-center justify-between border-b last:border-0 py-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary">{formatDateBR(t.date)}</Badge>
                    <span className="truncate">{t.description}</span>
                    <span className="text-muted-foreground text-xs">
                      {t.card?.name ?? t.account?.name ?? "—"}
                    </span>
                  </span>
                  <span className="font-medium">
                    {t.type === "despesa" ? "-" : "+"}
                    {formatBRL(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
