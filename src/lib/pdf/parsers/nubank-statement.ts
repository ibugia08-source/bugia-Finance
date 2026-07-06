import type { PdfParseResult, PdfTransaction } from "../types";

/**
 * Parser "nubank-statement" — extrato/fatura do Nubank onde o pdf-parse quebra
 * cada compra em DUAS linhas:
 *
 *   "04 JUN"                                        (linha só com a data)
 *   "•••• 9560Mp *Storealefsigma - Parcela 3/4R$ 33,50"   (cartão + descrição + valor)
 *
 * As compras SEMPRE começam com o marcador do cartão ("•••• 9560"). Já os
 * pagamentos, créditos e encargos (Multa/IOF/Juros de atraso, "Pagamento em…",
 * "Crédito de atraso") NÃO têm esse marcador — então são naturalmente ignorados,
 * o que é o comportamento correto para um balanço de gastos.
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

// Linha que contém apenas a data: "04 JUN", "14 jun"
const DATE_ONLY_RE = /^(\d{1,2})\s+([A-Za-zçÇ]{3})\.?$/;
// Linha de compra: um ou mais bullets, 4 dígitos do cartão, descrição e valor colado
const TX_RE =
  /^[••·]{2,}\s*(\d{4})(.+?)R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
// Parcela ao fim da descrição: "- Parcela 3/4" ou "Parcela 3 de 4"
const INSTALLMENT_RE = /-?\s*parcela\s+(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function detectYear(text: string): number {
  // Prioriza a data de emissão/fatura no cabeçalho ("FATURA 13 JUL 2026").
  const head = text.split(/\r?\n/).slice(0, 8).join(" ");
  const m = head.match(/\b(20\d{2})\b/) || text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function detectClosingAndDue(text: string): { closing?: Date; due?: Date } {
  const out: { closing?: Date; due?: Date } = {};
  const dueDmy = text.match(/venc[ie]mento[^\d]*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (dueDmy) {
    const [, d, m, y] = dueDmy;
    out.due = new Date(Number(y.length === 2 ? "20" + y : y), Number(m) - 1, Number(d));
  }
  return out;
}

function detectTotal(text: string): number | undefined {
  const m =
    text.match(/total\s+a\s+pagar[^\d]*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i) ||
    text.match(/total\s+da\s+fatura[^\d]*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return Math.abs(parseAmount(m[1]));
  return undefined;
}

export function tryNubankStatement(text: string): PdfParseResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const year = detectYear(text);
  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];

  let lastMonth: number | null = null;
  let lastDay: number | null = null;

  for (const line of lines) {
    const dateMatch = line.match(DATE_ONLY_RE);
    if (dateMatch) {
      const key = dateMatch[2]
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .slice(0, 3);
      if (key in MONTHS_PT) {
        lastMonth = MONTHS_PT[key];
        lastDay = Number(dateMatch[1]);
      }
      continue;
    }

    const tx = line.match(TX_RE);
    if (!tx) continue;
    if (lastMonth === null || lastDay === null) {
      ignored.push(line);
      continue;
    }

    const amount = Math.abs(parseAmount(tx[3]));
    if (!amount) continue;

    let description = tx[2].trim();
    let installment: number | null = null;
    let totalInstallments: number | null = null;
    const inst = description.match(INSTALLMENT_RE);
    if (inst) {
      installment = Number(inst[1]);
      totalInstallments = Number(inst[2]);
      description = description.replace(INSTALLMENT_RE, "").replace(/[-\s]+$/, "").trim();
    }
    if (!description) description = "Transação";

    transactions.push({
      date: new Date(year, lastMonth, lastDay),
      description,
      amount,
      installment,
      totalInstallments,
    });
  }

  if (transactions.length === 0) return null;

  const { closing, due } = detectClosingAndDue(text);
  return {
    layout: "nubank-statement",
    transactions,
    ignoredLines: ignored,
    closingDate: closing,
    dueDate: due,
    totalDetected: detectTotal(text),
  };
}
