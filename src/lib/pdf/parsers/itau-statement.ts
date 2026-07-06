import type { PdfParseResult, PdfTransaction } from "../types";

/**
 * Parser "itau-statement" — fatura/extrato do Itaú (inclui cartões business),
 * onde o pdf-parse cola tudo: "DDMM<DESCRIÇÃO>[NN/NN]<VALOR>" e por vezes
 * concatena duas transações na mesma linha (efeito das duas colunas do PDF).
 *
 * Exemplos:
 *   "10/02ANUIDADE DIFERENCI02/1214,99"        → 10/02, ANUIDADE DIFERENCI, 02/12, 14,99
 *   "17/02DOCTOR WISE35,01"                    → 17/02, DOCTOR WISE, 35,01
 *   "26/06MAGAZINE LUIZA 77921/24141,64…"      → 26/06, MAGAZINE LUIZA 779, 21/24, 141,64
 *
 * IMPORTANTE: só consideramos os LANÇAMENTOS ATUAIS. As seções "Compras
 * parceladas - próximas faturas" e "Demais faturas" (parcelas futuras) são
 * cortadas para não inflar o balanço do mês. Como o layout multi-coluna é
 * instável, expomos `totalDetected` (Total dos lançamentos atuais) para o
 * usuário conferir a soma no preview.
 */

const AMOUNT = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`;
// date + (desc mínima) + valor; instalação é destacada depois
const SCAN_RE = new RegExp(`(\\d{2})\\/(\\d{2})(.*?)(${AMOUNT})`, "g");
const INSTALLMENT_TAIL_RE = /(\d{2})\/(\d{2})$/;

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function detectYear(text: string): number {
  const m =
    text.match(/emiss[ãa]o:?\s*\d{2}\/\d{2}\/(\d{4})/i) ||
    text.match(/vencimento:?\s*\d{2}\/\d{2}\/(\d{4})/i) ||
    text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function detectDue(text: string): Date | undefined {
  const m = text.match(/vencimento:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return undefined;
}

/** "Total dos lançamentos atuais 1.508,23" ou "Lançamentos atuais 1.508,23" */
function detectCurrentTotal(text: string): number | undefined {
  const m =
    text.match(/total\s+dos\s+lan[çc]amentos\s+atuais[^\d]*(\d{1,3}(?:\.\d{3})*,\d{2})/i) ||
    text.match(/lan[çc]amentos\s+atuais[^\d]*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (m) return parseAmount(m[1]);
  return undefined;
}

/**
 * Recorta o texto para a região dos lançamentos ATUAIS: começa no cabeçalho das
 * transações e termina quando aparece a seção de parcelas futuras.
 */
function currentRegion(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/lan[çc]amentos:?\s*compras|final\s+\d{3,4}\)|DATA\s*ESTABELECIMENTO/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (/compras\s+parceladas|pr[oó]ximas\s+faturas|demais\s+faturas|continua\.\.\./i.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function tryItauStatement(text: string): PdfParseResult | null {
  const region = currentRegion(text);
  const year = detectYear(text);
  const declaredTotal = detectCurrentTotal(text);

  const transactions: PdfTransaction[] = [];
  const seen = new Set<string>();

  for (const rawLine of region.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Ignora linhas de subtotal/estrutura (sem data no formato DD/MM no começo de um trecho)
    SCAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SCAN_RE.exec(line)) !== null) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue;
      let desc = m[3].trim();
      const amount = parseAmount(m[4]);
      if (!amount) continue;

      let installment: number | null = null;
      let totalInstallments: number | null = null;
      const inst = desc.match(INSTALLMENT_TAIL_RE);
      if (inst) {
        installment = Number(inst[1]);
        totalInstallments = Number(inst[2]);
        desc = desc.replace(INSTALLMENT_TAIL_RE, "").trim();
      }
      // descrição precisa ter conteúdo textual (evita capturar ruído numérico)
      if (!/[A-Za-zÀ-ÿ]{3,}/.test(desc)) continue;

      const date = new Date(year, mm - 1, dd);
      const key = `${date.toISOString().slice(0, 10)}|${desc}|${amount}|${installment}/${totalInstallments}`;
      if (seen.has(key)) continue;
      seen.add(key);

      transactions.push({ date, description: desc, amount, installment, totalInstallments });
    }
  }

  if (transactions.length === 0) return null;

  // Guarda de segurança: o layout multi-coluna do Itaú é instável na extração de
  // texto. Só confiamos no resultado se a soma reconciliar com o "Total dos
  // lançamentos atuais" declarado na fatura (tolerância de 1%). Caso contrário
  // devolvemos null para NÃO importar valores incorretos — o usuário é orientado
  // a usar CSV/XLSX. Sem total declarado para conferir, também não arriscamos.
  if (declaredTotal == null) return null;
  const soma = transactions.reduce((s, t) => s + t.amount, 0);
  const tolerance = Math.max(declaredTotal * 0.01, 0.5);
  if (Math.abs(soma - declaredTotal) > tolerance) return null;

  return {
    layout: "itau-statement",
    transactions,
    ignoredLines: [],
    dueDate: detectDue(text),
    totalDetected: declaredTotal,
  };
}
