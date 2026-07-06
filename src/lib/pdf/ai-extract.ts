import {
  getAISettings,
  isConfigured,
  chatComplete,
  AINotConfiguredError,
} from "@/lib/ai/provider";
import type { PdfParseResult, PdfTransaction, StatementMeta } from "./types";

/**
 * Extração de fatura/extrato por IA — fallback para documentos que os parsers
 * fixos (Nubank/Inter/C6/Itaú) não reconhecem. Envia o texto do documento ao
 * modelo configurado no Assistente e recebe os dados estruturados em JSON:
 * banco, titular, cartão, limites, saldo, total, mínimo e as transações.
 *
 * Lança AINotConfiguredError se a IA não estiver configurada/ativada.
 */

const SYSTEM_PROMPT = `Você é um extrator de dados de faturas e extratos de cartão de crédito e conta bancária brasileiros.
Receberá o TEXTO bruto extraído de um documento (PDF/DOCX). Ele pode ser uma fatura fechada, em aberto, paga ou não paga.
Sua tarefa é devolver SOMENTE um JSON (sem markdown, sem comentários, sem texto antes/depois) com este formato exato:

{
  "bankName": string|null,            // nome do banco/emissor (ex.: "C6 Bank", "Nubank", "Banco Inter")
  "holder": string|null,              // nome do titular
  "cardLastDigits": string|null,      // 4 últimos dígitos do cartão, se houver
  "accountName": string|null,         // identificação da conta, se houver
  "dueDate": string|null,             // vencimento, ISO "YYYY-MM-DD"
  "closingDate": string|null,         // fechamento, ISO "YYYY-MM-DD"
  "total": number|null,               // valor total da fatura
  "minimumPayment": number|null,      // pagamento mínimo
  "limitTotal": number|null,          // limite total
  "limitUsed": number|null,           // limite utilizado
  "limitAvailable": number|null,      // limite disponível
  "balance": number|null,             // saldo (extrato) ou saldo devedor
  "previousBalance": number|null,     // fatura/saldo anterior
  "transactions": [
    {
      "date": string,                 // ISO "YYYY-MM-DD" da compra
      "description": string,          // descrição do estabelecimento/lançamento
      "amount": number,               // valor positivo, ponto como separador decimal
      "installment": number|null,     // nº da parcela atual (ex.: 3 em "3/10")
      "totalInstallments": number|null,// total de parcelas (ex.: 10 em "3/10")
      "isCredit": boolean             // true para pagamentos, estornos, créditos; false para compras/gastos
    }
  ]
}

Regras:
- Valores SEMPRE como número (ex.: 1503.91), sem "R$", sem separador de milhar.
- Datas SEMPRE ISO "YYYY-MM-DD". Se só houver dia/mês, infira o ano pelo vencimento/fechamento.
- Marque isCredit=true em pagamentos de fatura, estornos, créditos e reembolsos; false em compras.
- NÃO invente dados. Use null quando o campo não existir no documento.
- Inclua TODAS as transações que encontrar, mesmo que a fatura não esteja fechada/paga.
- Responda apenas o JSON.`;

function extractJson(text: string): any {
  let t = text.trim();
  // remove cercas de código ```json ... ```
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("A IA não retornou um JSON reconhecível.");
  }
  return JSON.parse(t.slice(start, end + 1));
}

function toDate(iso: unknown): Date | undefined {
  if (typeof iso !== "string") return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? undefined : d;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return isFinite(n) ? n : null;
  }
  return null;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

export async function aiExtractStatement(documentText: string): Promise<PdfParseResult> {
  const settings = await getAISettings();
  if (!isConfigured(settings)) throw new AINotConfiguredError();

  // Limita o tamanho enviado para não estourar contexto de modelos menores.
  const text = documentText.slice(0, 24000);

  const { text: raw } = await chatComplete({
    settings,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
    maxTokens: 4000,
  });

  const data = extractJson(raw);

  const transactions: PdfTransaction[] = [];
  for (const t of Array.isArray(data.transactions) ? data.transactions : []) {
    if (t?.isCredit === true) continue; // pagamentos/estornos não entram como gasto
    const date = toDate(t?.date);
    const amount = toNum(t?.amount);
    const description = typeof t?.description === "string" ? t.description.trim() : "";
    if (!date || amount == null || amount === 0 || !description) continue;
    transactions.push({
      date,
      description,
      amount: Math.abs(amount),
      installment: toNum(t?.installment),
      totalInstallments: toNum(t?.totalInstallments),
      cardLastDigits: typeof t?.cardLastDigits === "string" ? t.cardLastDigits : null,
    });
  }

  if (transactions.length === 0) {
    throw new Error("A IA não encontrou transações reconhecíveis neste documento.");
  }

  const meta: StatementMeta = {
    bankName: data.bankName ?? null,
    holder: data.holder ?? null,
    cardLastDigits: data.cardLastDigits ?? null,
    accountName: data.accountName ?? null,
    minimumPayment: toNum(data.minimumPayment),
    limitTotal: toNum(data.limitTotal),
    limitUsed: toNum(data.limitUsed),
    limitAvailable: toNum(data.limitAvailable),
    balance: toNum(data.balance),
    previousBalance: toNum(data.previousBalance),
  };

  const bankName = typeof data.bankName === "string" ? data.bankName : null;

  return {
    layout: "ai",
    transactions,
    ignoredLines: [],
    closingDate: toDate(data.closingDate),
    dueDate: toDate(data.dueDate),
    totalDetected: toNum(data.total) ?? undefined,
    issuer: bankName ? { key: slug(bankName), label: bankName } : null,
    meta,
  };
}
