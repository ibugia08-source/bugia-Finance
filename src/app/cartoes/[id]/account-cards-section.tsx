"use client";
import { useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { AccountCardDialog } from "./account-card-dialog";
import { deleteAccountCard } from "@/lib/actions/account-cards";
import { Pencil, Trash2 } from "lucide-react";

export function AccountCardsSection({
  cardId,
  accountCards,
}: {
  cardId: string;
  accountCards: any[];
}) {
  const sumLimits = accountCards.reduce((s, c) => s + (c.limit ?? 0), 0);

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Cartões da conta</CardTitle>
        <AccountCardDialog cardId={cardId} />
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cartão</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Final</TableHead>
              <TableHead className="text-right">Limite</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountCards.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                  Nenhum cartão nesta conta. Adicione os cartões físicos e virtuais.
                </TableCell>
              </TableRow>
            )}
            {accountCards.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <Badge variant={c.kind === "virtual" ? "secondary" : "outline"}>
                    {c.kind === "virtual" ? "Virtual" : "Físico"}
                  </Badge>
                </TableCell>
                <TableCell>{c.lastDigits ? `•••• ${c.lastDigits}` : "—"}</TableCell>
                <TableCell className="text-right">{formatBRL(c.limit ?? 0)}</TableCell>
                <TableCell className="text-right">
                  <RowActions cardId={cardId} accountCard={c} />
                </TableCell>
              </TableRow>
            ))}
            {accountCards.length > 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium text-muted-foreground">
                  Soma dos limites dos cartões
                </TableCell>
                <TableCell className="text-right font-semibold">{formatBRL(sumLimits)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RowActions({ cardId, accountCard }: { cardId: string; accountCard: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <AccountCardDialog
        cardId={cardId}
        initial={accountCard}
        trigger={
          <Button size="icon" variant="ghost">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        size="icon"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (confirm(`Excluir o cartão "${accountCard.name}"?`)) {
            start(() => deleteAccountCard(accountCard.id));
          }
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
