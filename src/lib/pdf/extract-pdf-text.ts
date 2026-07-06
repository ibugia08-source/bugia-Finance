/* eslint-disable @typescript-eslint/no-var-requires */
// Extrator de texto de PDF com suporte a SENHA. O `pdf-parse` não repassa senha
// ao pdf.js (chama getDocument(buffer) direto), então faturas de banco
// criptografadas falham com PasswordException. Aqui usamos o mesmo pdf.js
// embutido no pdf-parse, mas passando { data, password }, e replicamos a mesma
// lógica de quebra de linha por posição Y que o pdf-parse usa — para que os
// parsers por banco continuem funcionando igual.

const PDFJS = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");

export class PdfPasswordError extends Error {
  /** true = senha informada está incorreta; false = falta a senha */
  incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? "Senha incorreta." : "PDF protegido por senha.");
    this.name = "PdfPasswordError";
    this.incorrect = incorrect;
  }
}

async function renderPage(pageData: any): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === undefined) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = item.transform[5];
  }
  return text;
}

export type PdfTextResult = { text: string; numpages: number };

/**
 * Extrai o texto do PDF. Se `password` for informada, tenta decriptar com ela.
 * Lança PdfPasswordError quando o PDF é criptografado e a senha falta/está errada.
 */
export async function extractPdfText(
  buffer: Buffer,
  password?: string
): Promise<PdfTextResult> {
  PDFJS.disableWorker = true;

  let doc: any;
  try {
    doc = await PDFJS.getDocument({
      data: buffer,
      password: password && password.length > 0 ? password : undefined,
    });
  } catch (e: any) {
    if (e?.name === "PasswordException") {
      // code 2 = INCORRECT_PASSWORD, 1 = NEED_PASSWORD (pdf.js PasswordResponses)
      throw new PdfPasswordError(e?.code === 2);
    }
    throw e;
  }

  const numpages = doc.numPages;
  let text = "";
  for (let i = 1; i <= numpages; i++) {
    const pageText = await doc
      .getPage(i)
      .then((page: any) => renderPage(page))
      .catch(() => "");
    text += `\n\n${pageText}`;
  }
  doc.destroy();

  return { text, numpages };
}
