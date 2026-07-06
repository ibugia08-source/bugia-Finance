import mammoth from "mammoth";
import {
  parseInvoicePdf,
  buildResultFromText,
  PdfImportError,
  type PdfDiagnostics,
} from "./parse-invoice-pdf";
import type { PdfParseResult } from "./types";
import { aiExtractStatement } from "./ai-extract";
import { AINotConfiguredError } from "@/lib/ai/provider";

export type StatementFileMeta = { name?: string; size?: number; type?: string };

const DOCX_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

function isDocx(buffer: Buffer, meta: StatementFileMeta): boolean {
  const name = (meta.name ?? "").toLowerCase();
  if (name.endsWith(".docx")) return true;
  if (meta.type && DOCX_TYPES.includes(meta.type)) return true;
  // .docx é um zip → começa com "PK". Só tratamos como docx se não for PDF.
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const isPdf = buffer.indexOf("%PDF") !== -1;
  return isZip && !isPdf;
}

async function parseDocx(
  buffer: Buffer,
  meta: StatementFileMeta
): Promise<PdfParseResult & { diagnostics: PdfDiagnostics }> {
  const name = (meta.name ?? "").toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    throw new PdfImportError(
      "PARSE_FAIL",
      "Arquivos .doc (Word antigo) não são suportados. Salve como .docx ou PDF e tente novamente.",
      { layout: "unknown", totalLines: 0, recognized: 0, sampleLines: [], fileName: meta.name, fileSize: meta.size, fileType: meta.type }
    );
  }

  let text = "";
  try {
    const result = await mammoth.extractRawText({ buffer });
    text = (result.value ?? "").trim();
  } catch (e: any) {
    throw new PdfImportError(
      "PARSE_FAIL",
      "Não conseguimos ler este DOCX. Verifique se o arquivo não está corrompido ou exporte em PDF/CSV.",
      {
        layout: "unknown",
        totalLines: 0,
        recognized: 0,
        sampleLines: [],
        fileName: meta.name,
        fileSize: meta.size,
        fileType: meta.type,
        technicalError: e?.message ?? String(e),
      }
    );
  }

  if (!text) {
    throw new PdfImportError(
      "NO_TEXT",
      "Este DOCX não contém texto extraível (pode ser só imagens). Exporte em CSV/XLSX ou use um documento com texto.",
      { layout: "unknown", totalLines: 0, recognized: 0, sampleLines: [], fileName: meta.name, fileSize: meta.size, fileType: meta.type }
    );
  }

  // DOCX não tem posição de colunas: o texto do mammoth já vem separado, então
  // usamos o mesmo texto como "espaçado".
  return buildResultFromText(text, text, {
    fileName: meta.name,
    fileSize: meta.size,
    fileType: meta.type,
  });
}

/**
 * Ponto de entrada unificado: recebe o buffer de um extrato/fatura em PDF ou
 * DOCX, extrai o texto conforme o formato e devolve as transações reconhecidas.
 */
export async function parseStatementFile(
  buffer: Buffer,
  meta: StatementFileMeta = {},
  password?: string
): Promise<PdfParseResult & { diagnostics: PdfDiagnostics }> {
  try {
    if (isDocx(buffer, meta)) {
      return await parseDocx(buffer, meta);
    }
    return await parseInvoicePdf(buffer, meta, password);
  } catch (e) {
    // Fallback de IA: documento não reconhecido pelos parsers fixos. Se a IA
    // estiver configurada, tenta extrair os dados dela a partir do texto.
    if (
      e instanceof PdfImportError &&
      e.reason === "NO_LAYOUT" &&
      e.diagnostics?.fullText
    ) {
      try {
        const ai = await aiExtractStatement(e.diagnostics.fullText);
        return { ...ai, diagnostics: { ...e.diagnostics, layout: "ai" } };
      } catch (aiErr) {
        // IA não configurada → mantém a mensagem original (parsers não reconheceram).
        if (aiErr instanceof AINotConfiguredError) throw e;
        throw aiErr;
      }
    }
    throw e;
  }
}
