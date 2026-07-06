import type { PdfParseResult, PdfTransaction } from "../types";

/**
 * Parser "c6-statement" — fatura/extrato do C6 Bank.
 *
 * O C6 dispõe as transações em colunas (data | descrição | [parcela] | valor).
 * Na extração COLADA elas ficariam ambíguas ("16 maiTIM*7599182635378,99"),
 * então este parser usa o texto ESPAÇADO (colunas separadas por espaço):
 *
 *   "16 mai TIM*75991826353 78,99"
 *   "19 jan CASA ESPORTIVA LJ 13  - Parcela 5/10 89,99"
 *   "15 mai Pagamento Fatura QR CODE 1.516,97"   ← pagamento (crédito) → ignorado
 *
 * Como a soma é conferível contra "Compras nacionais"/"Total a pagar", validamos
 * o resultado e só o aceitamos se reconciliar (evita lançar valor errado).
 */

const MONTHS_PT: Record<string, number> = {
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5,
  jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

const LINE_RE =
  /^(\d{1,2})\s+([a-zç]{3})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/i;
const INSTALLMENT_RE = /\s*-\s*parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

// Linhas que NÃO são compras (pagamentos/créditos/estornos).
const CREDIT_RE = /pagamento\s+(fatura|recebido|efetuado)|estorno|cr[ée]dito\s+de/i;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function detectYear(text: string): number {
  const m =
    text.match(/vencimento[^\d]*(\d{2})\/(\d{2})\/(20\d{2})/i) ||
    text.match(/(\d{2})\/(\d{2})\/(20\d{2})/);
  return m ? Number(m[3]) : new Date().getFullYear();
}

function detectDue(text: string): Date | undefined {
  const m = text.match(/vencimento[^\d]*(\d{2})\/(\d{2})\/(20\d{2})/i);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return undefined;
}

/** Total de compras da fatura, para reconciliação. */
function detectPurchasesTotal(text: string): number | undefined {
  const m =
    text.match(/compras\s+nacionais\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i) ||
    text.match(/total\s+a\s+pagar\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return parseAmount(m[1]);
  return undefined;
}

export function tryC6Statement(text: string): PdfParseResult | null {
  // Só tenta se o documento for claramente do C6 (evita falsos positivos).
  if (!/c6\s*bank|banco c6|cart[ãa]o c6/i.test(text)) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const year = detectYear(text);
  const transactions: PdfTransaction[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const m = line.match(LINE_RE);
    if (!m) continue;

    const monthKey = m[2]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .slice(0, 3);
    if (!(monthKey in MONTHS_PT)) continue;

    let description = m[3].trim();
    if (CREDIT_RE.test(description)) {
      ignored.push(line);
      continue;
    }

    const amount = Math.abs(parseAmount(m[4]));
    if (!amount) continue;

    let installment: number | null = null;
    let totalInstallments: number | null = null;
    const inst = description.match(INSTALLMENT_RE);
    if (inst) {
      installment = Number(inst[1]);
      totalInstallments = Number(inst[2]);
      description = description.replace(INSTALLMENT_RE, "").trim();
    }
    // colapsa espaços internos que o layout em colunas possa ter deixado
    description = description.replace(/\s{2,}/g, " ").trim();
    if (!description) description = "Transação";

    const date = new Date(year, MONTHS_PT[monthKey], Number(m[1]));
    const key = `${date.toISOString().slice(0, 10)}|${description}|${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push({ date, description, amount, installment, totalInstallments });
  }

  if (transactions.length === 0) return null;

  const declaredTotal = detectPurchasesTotal(text);
  // Guarda de segurança: se há total declarado, exige reconciliação (1%).
  if (declaredTotal != null) {
    const soma = transactions.reduce((s, t) => s + t.amount, 0);
    const tolerance = Math.max(declaredTotal * 0.01, 0.5);
    if (Math.abs(soma - declaredTotal) > tolerance) return null;
  }

  return {
    layout: "c6-statement",
    transactions,
    ignoredLines: ignored,
    dueDate: detectDue(text),
    totalDetected: declaredTotal,
  };
}
