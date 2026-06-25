"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseFile, type ParseDiagnostics, type ParsedRow } from "@/lib/services/parseImport";
import { applyRules } from "@/lib/services/rules";
import { attachToInvoice } from "@/lib/services/invoices";
import { transactionHash } from "@/lib/services/hash";

export type PreviewRow = {
  date: Date | null;
  description: string;
  amount: number;
  isCredit: boolean;
  installment?: number | null;
  totalInstallments?: number | null;
  duplicate: boolean;
  hash: string;
  reason?: string;
  suggestedCategoryName?: string | null;
};

export type PreviewResult =
  | {
      ok: true;
      total: number;             // total de linhas lidas
      valid: number;             // linhas reconhecidas
      ignored: number;           // linhas ignoradas
      duplicates: number;
      detectedColumns: ParseDiagnostics["detectedColumns"];
      rawSample: Record<string, any>[];
      parsedSample: ParsedRow[];
      ignoredReasons: ParseDiagnostics["ignoredReasons"];
      rows: PreviewRow[];
    }
  | { ok: false; error: string };

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || null;
  const accountId = (formData.get("accountId") as string) || null;
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let diag: ParseDiagnostics;
  try {
    diag = await parseFile(file);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao ler arquivo." };
  }

  const categories = await prisma.category.findMany({
    select: { id: true, name: true },
  });
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  const rows: PreviewRow[] = [];
  let duplicates = 0;
  for (const r of diag.rows) {
    let duplicate = false;
    let hash = "";
    let suggestedCategoryName: string | null = null;

    if (!r.reason && r.date) {
      hash = transactionHash({
        date: r.date,
        description: r.description,
        amount: r.amount,
        cardId,
        accountId,
      });
      const existing = await prisma.transaction.findUnique({ where: { hash } });
      duplicate = !!existing;
      if (duplicate) duplicates++;

      const effects = await applyRules({
        description: r.description,
        cardId,
        amount: r.amount,
      });
      if (effects.categoryId) {
        suggestedCategoryName = catById.get(effects.categoryId) ?? null;
      }
    }

    rows.push({
      date: r.date,
      description: r.description,
      amount: r.amount,
      isCredit: r.isCredit,
      installment: r.installment,
      totalInstallments: r.totalInstallments,
      duplicate,
      hash,
      reason: r.reason,
      suggestedCategoryName,
    });
  }

  return {
    ok: true,
    total: diag.totalLines,
    valid: diag.validLines,
    ignored: diag.ignoredLines,
    duplicates,
    detectedColumns: diag.detectedColumns,
    rawSample: diag.rawSample,
    parsedSample: diag.parsedSample,
    ignoredReasons: diag.ignoredReasons,
    rows,
  };
}

export type CommitResult =
  | {
      ok: true;
      total: number;
      imported: number;
      duplicates: number;
      ignored: number;
      batchId: string;
    }
  | { ok: false; error: string };

export async function commitImport(formData: FormData): Promise<CommitResult> {
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || null;
  const accountId = (formData.get("accountId") as string) || null;
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let diag: ParseDiagnostics;
  try {
    diag = await parseFile(file);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao ler arquivo." };
  }

  if (diag.validLines === 0) {
    const cols = diag.detectedColumns;
    const detected = [
      cols.date && `data="${cols.date}"`,
      cols.description && `descrição="${cols.description}"`,
      cols.amount && `valor="${cols.amount}"`,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      ok: false,
      error: `Lemos ${diag.totalLines} linhas, mas nenhuma tinha data/descrição/valor reconhecíveis. Colunas encontradas: ${
        detected || "nenhuma reconhecida"
      }. Pré-visualize antes para investigar.`,
    };
  }

  const batch = await prisma.importBatch.create({
    data: {
      source: file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
      fileName: file.name,
      cardId: cardId || null,
      accountId: accountId || null,
      total: diag.validLines,
    },
  });

  let imported = 0;
  let duplicates = 0;

  for (const r of diag.rows) {
    if (r.reason) continue;
    if (!r.date) continue;

    const hash = transactionHash({
      date: r.date,
      description: r.description,
      amount: r.amount,
      cardId,
      accountId,
    });
    const existing = await prisma.transaction.findUnique({ where: { hash } });
    if (existing) {
      duplicates++;
      continue;
    }

    const effects = await applyRules({
      description: r.description,
      cardId,
      amount: r.amount,
    });

    // Cartão: compras = despesa; estornos (valor negativo) = ajuste/receita
    const type = cardId
      ? r.isCredit
        ? "ajuste"
        : "despesa"
      : r.isCredit
        ? "receita"
        : "despesa";

    const tx = await prisma.transaction.create({
      data: {
        date: r.date,
        description: r.description,
        amount: r.amount,
        type,
        origin: cardId ? "cartao" : "pix",
        cardId: cardId || null,
        accountId: accountId || null,
        categoryId: effects.categoryId || null,
        responsibleId: effects.responsibleId || null,
        belongsTo: effects.belongsTo || "pessoal",
        status: effects.status || "pendente",
        reimbursable: effects.reimbursable || false,
        importBatchId: batch.id,
        hash,
      },
    });

    if (r.installment && r.totalInstallments && r.totalInstallments > 1) {
      const each = Number((r.amount / r.totalInstallments).toFixed(2));
      const installments = [];
      for (let i = 1; i <= r.totalInstallments; i++) {
        const due = new Date(r.date);
        due.setMonth(due.getMonth() + (i - 1));
        installments.push({
          transactionId: tx.id,
          number: i,
          total: r.totalInstallments,
          amount: each,
          dueDate: due,
          paid: false,
        });
      }
      await prisma.installment.createMany({ data: installments });
    }

    if (cardId) await attachToInvoice(tx.id);
    imported++;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, duplicates },
  });

  revalidatePath("/transacoes");
  revalidatePath("/dashboard");
  revalidatePath("/importar");
  revalidatePath("/importar");
  if (cardId) {
    revalidatePath("/cartoes");
    revalidatePath(`/cartoes/${cardId}`);
  }

  return {
    ok: true,
    batchId: batch.id,
    imported,
    duplicates,
    ignored: diag.ignoredLines,
    total: diag.totalLines,
  };
}
