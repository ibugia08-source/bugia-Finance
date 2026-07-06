export type PdfTransaction = {
  date: Date;
  description: string;
  amount: number;
  installment?: number | null;
  totalInstallments?: number | null;
  /** Final (4 dígitos) do cartão físico/virtual, quando a fatura agrupa por cartão. */
  cardLastDigits?: string | null;
};

/**
 * Metadados da fatura/extrato além das transações (banco, conta, limites, saldo).
 * Preenchido principalmente pela extração por IA de documentos não reconhecidos
 * pelos parsers fixos.
 */
export type StatementMeta = {
  bankName?: string | null;
  holder?: string | null;          // titular do cartão/conta
  cardLastDigits?: string | null;  // final do cartão
  accountName?: string | null;     // nome/identificação da conta
  minimumPayment?: number | null;  // pagamento mínimo
  limitTotal?: number | null;      // limite total
  limitUsed?: number | null;       // limite utilizado
  limitAvailable?: number | null;  // limite disponível
  balance?: number | null;         // saldo (extrato de conta) ou saldo devedor
  previousBalance?: number | null; // fatura/saldo anterior
};

export type PdfParseResult = {
  layout: string;            // identificador do parser que casou
  transactions: PdfTransaction[];
  ignoredLines: string[];    // linhas que não casaram com transação
  closingDate?: Date;        // se detectado
  dueDate?: Date;            // se detectado
  totalDetected?: number;    // valor total da fatura, se encontrado
  issuer?: { key: string; label: string } | null; // banco/emissor detectado
  meta?: StatementMeta;      // dados extras da fatura (limite, saldo, etc.)
};
