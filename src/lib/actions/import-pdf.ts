"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { applyRules } from "@/lib/services/rules";
import { attachToInvoice } from "@/lib/services/invoices";
import { transactionHash } from "@/lib/services/hash";
import {
  parseInvoicePdf,
  PdfImportError,
  type PdfTransaction,
  type PdfDiagnostics,
  type PdfErrorReason,
} from "@/lib/pdf/parse-invoice-pdf";
import { matchCardsByIssuer } from "@/lib/pdf/detect-issuer";
import { requireAdmin } from "@/lib/auth/viewer";

export type PdfPreviewRow = PdfTransaction & {
  duplicate: boolean;
  hash: string;
  suggestedCategoryName?: string | null;
};

export type DetectedCard = { id: string; name: string; bank: string | null };

export type PdfPreviewResult =
  | {
      ok: true;
      layout: string;
      rows: PdfPreviewRow[];
      ignoredLines: string[];
      closingDate?: Date;
      dueDate?: Date;
      totalDetected?: number;
      total: number;
      duplicates: number;
      diagnostics: PdfDiagnostics;
      // Detecção automática de banco/cartão
      detectedIssuer?: { key: string; label: string } | null;
      suggestedCardId?: string | null;
      candidateCards: DetectedCard[];
    }
  | {
      ok: false;
      error: string;
      reason?: PdfErrorReason;
      diagnostics?: PdfDiagnostics;
      detectedIssuer?: { key: string; label: string } | null;
    };

async function readFileBuffer(file: File): Promise<Buffer> {
  // File/Blob → ArrayBuffer → Buffer
  const ab = await file.arrayBuffer();
  return Buffer.from(new Uint8Array(ab));
}

function fileMeta(file: File) {
  return { name: file.name, size: file.size, type: file.type };
}

export async function previewPdfImport(formData: FormData): Promise<PdfPreviewResult> {
  await requireAdmin();
  const file = formData.get("file") as File | null;
  const explicitCardId = (formData.get("cardId") as string) || "";
  if (!file) return { ok: false, error: "Arquivo ausente." };

  let parsed;
  try {
    const buf = await readFileBuffer(file);
    if (process.env.NODE_ENV !== "production") {
      console.info("[pdf-import] preview", {
        name: file.name,
        type: file.type,
        size: file.size,
        bufferLen: buf.length,
        head: buf.subarray(0, 20).toString("latin1").replace(/[^\x20-\x7e]/g, "."),
      });
    }
    parsed = await parseInvoicePdf(buf, fileMeta(file));
  } catch (e: any) {
    if (e instanceof PdfImportError) {
      return {
        ok: false,
        error: e.message,
        reason: e.reason,
        diagnostics: e.diagnostics,
      };
    }
    return { ok: false, error: e?.message ?? "Erro ao processar PDF." };
  }

  // Detecção automática de banco → cartão
  const allCards = await prisma.creditCard.findMany({
    where: { active: true },
    select: { id: true, name: true, bank: true },
    orderBy: { name: "asc" },
  });
  const detectedIssuer = parsed.issuer ?? null;
  const candidateCards = matchCardsByIssuer(detectedIssuer, allCards);
  // Cartão efetivo: o escolhido manualmente, ou o único casamento por banco
  const cardId =
    explicitCardId ||
    (candidateCards.length === 1 ? candidateCards[0].id : "");

  const categories = await prisma.category.findMany({
    select: { id: true, name: true },
  });
  const catById = new Map(categories.map((c) => [c.id, c.name]));

  const rows: PdfPreviewRow[] = [];
  let duplicates = 0;
  for (const t of parsed.transactions) {
    const hash = cardId
      ? transactionHash({
          date: t.date,
          description: t.description,
          amount: t.amount,
          cardId,
          accountId: null,
        })
      : "";
    const existing = hash
      ? await prisma.transaction.findUnique({ where: { hash } })
      : null;
    const duplicate = !!existing;
    if (duplicate) duplicates++;

    const effects = cardId
      ? await applyRules({
          description: t.description,
          cardId,
          amount: t.amount,
        })
      : { categoryId: null };
    const suggestedCategoryName = effects.categoryId
      ? catById.get(effects.categoryId) ?? null
      : null;

    rows.push({ ...t, hash, duplicate, suggestedCategoryName });
  }

  return {
    ok: true,
    layout: parsed.layout,
    rows,
    ignoredLines: parsed.ignoredLines,
    closingDate: parsed.closingDate,
    dueDate: parsed.dueDate,
    totalDetected: parsed.totalDetected,
    total: rows.length,
    duplicates,
    diagnostics: parsed.diagnostics,
    detectedIssuer,
    suggestedCardId: cardId || null,
    candidateCards,
  };
}

export type PdfCommitResult =
  | { ok: true; imported: number; duplicates: number; total: number; batchId: string }
  | { ok: false; error: string };

export async function commitPdfImport(formData: FormData): Promise<PdfCommitResult> {
  await requireAdmin();
  const file = formData.get("file") as File | null;
  const cardId = (formData.get("cardId") as string) || "";
  if (!file) return { ok: false, error: "Arquivo ausente." };
  if (!cardId) return { ok: false, error: "Cartão não informado." };

  let parsed;
  try {
    const buf = await readFileBuffer(file);
    parsed = await parseInvoicePdf(buf, fileMeta(file));
  } catch (e: any) {
    return {
      ok: false,
      error:
        e instanceof PdfImportError
          ? e.message
          : e?.message ?? "Erro ao processar PDF.",
    };
  }

  if (parsed.transactions.length === 0) {
    return { ok: false, error: "Nenhuma transação reconhecida no PDF. Pré-visualize antes." };
  }

  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) return { ok: false, error: "Cartão não encontrado." };

  const batch = await prisma.importBatch.create({
    data: {
      source: "pdf",
      fileName: file.name,
      cardId,
      total: parsed.transactions.length,
    },
  });

  let imported = 0;
  let duplicates = 0;

  for (const r of parsed.transactions) {
    const hash = transactionHash({
      date: r.date,
      description: r.description,
      amount: r.amount,
      cardId,
      accountId: null,
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

    const tx = await prisma.transaction.create({
      data: {
        date: r.date,
        description: r.description,
        amount: r.amount,
        type: "despesa",
        origin: "cartao",
        cardId,
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

    await attachToInvoice(tx.id);
    imported++;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { imported, duplicates },
  });

  revalidatePath("/cartoes");
  revalidatePath(`/cartoes/${cardId}`);
  revalidatePath("/transacoes");
  revalidatePath("/importar");
  revalidatePath("/dashboard");

  return {
    ok: true,
    batchId: batch.id,
    imported,
    duplicates,
    total: parsed.transactions.length,
  };
}
