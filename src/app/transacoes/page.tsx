import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Filters } from "./filters";
import { getViewer, isUnlinkedUser } from "@/lib/auth/viewer";
import { UnlinkedBanner } from "@/components/unlinked-banner";

type Search = {
  mes?: string;
  pessoa?: string;
  cartao?: string;
  categoria?: string;
  status?: string;
  tipo?: string;
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

export default async function TransacoesPage({ searchParams }: { searchParams: Search }) {
  const viewer = await getViewer("/transacoes");
  if (viewer.role === "USER") {
    if (isUnlinkedUser(viewer)) return <UnlinkedBanner />;
  }

  const where: any = {};
  if (viewer.role === "USER") {
    // USER comum: só transações onde ele é responsável
    where.responsibleId = viewer.personId!;
  }

  if (searchParams.mes) {
    const [y, m] = searchParams.mes.split("-").map(Number);
    if (y && m) {
      const ref = new Date(y, m - 1, 1);
      const { start, end } = monthRange(ref);
      where.date = { gte: start, lt: end };
    }
  }
  if (searchParams.pessoa && viewer.role === "ADMIN") where.responsibleId = searchParams.pessoa;
  if (searchParams.cartao) where.cardId = searchParams.cartao;
  if (searchParams.categoria) where.categoryId = searchParams.categoria;
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.tipo) where.type = searchParams.tipo;

  const [transactions, cards, people, categories] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      include: { card: true, category: true, responsible: true, account: true },
      take: 200,
    }),
    prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Movimentações"
        description="Histórico de todas as movimentações feitas na plataforma."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <Filters cards={cards} people={people} categories={categories} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Cartão / Conta</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Pertence a</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhuma transação encontrada.
                  </TableCell>
                </TableRow>
              )}
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{formatDateBR(t.date)}</TableCell>
                  <TableCell className="max-w-xs truncate">{t.description}</TableCell>
                  <TableCell>{t.category?.name ?? "—"}</TableCell>
                  <TableCell>{t.card?.name ?? t.account?.name ?? "—"}</TableCell>
                  <TableCell>{t.responsible?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{t.belongsTo}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${t.type === "receita" ? "text-emerald-600" : ""}`}>
                    {t.type === "despesa" ? "-" : "+"}
                    {formatBRL(t.amount)}
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
