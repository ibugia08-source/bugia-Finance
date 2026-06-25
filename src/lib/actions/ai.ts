"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/viewer";
import {
  getAISettings,
  isConfigured,
  chatComplete,
  testConnection,
  type AISettings,
  type ChatMsg,
} from "@/lib/ai/provider";
import { buildFinancialSnapshot, snapshotToText, loadMemoryText } from "@/lib/ai/context";

const SINGLETON_ID = "default";
const HISTORY_LIMIT = 12;

const BASE_ROLE = `Você é o "Bugia Copiloto", um assistente financeiro pessoal integrado ao app de finanças do usuário.
Sua missão: analisar os dados financeiros reais fornecidos e ajudar com clareza — relatórios, dicas práticas, alertas e boas práticas.
Regras:
- Responda SEMPRE em português do Brasil, de forma objetiva e acionável.
- Baseie-se nos dados fornecidos (retrato financeiro + memórias). Se algo não estiver nos dados, diga que não tem a informação em vez de inventar.
- Use valores em reais (R$). Seja específico (cite números, categorias, contas e pessoas reais).
- Quando fizer sentido, traga próximos passos numerados e priorizados.
- Tom de copiloto: direto, encorajador e honesto sobre riscos (endividamento, faturas, reserva baixa).`;

async function requireConfigured(): Promise<AISettings> {
  const s = await getAISettings();
  if (!isConfigured(s)) {
    throw new Error(
      "A IA ainda não está configurada. Abra as configurações do Assistente e informe provedor, modelo e chave de API (e marque como ativa)."
    );
  }
  return s;
}

async function buildSystemPrompt(): Promise<string> {
  const snapshot = await buildFinancialSnapshot();
  const memory = await loadMemoryText();
  const parts = [
    BASE_ROLE,
    "\n===== RETRATO FINANCEIRO ATUAL =====\n" + snapshotToText(snapshot),
  ];
  if (memory) {
    parts.push(
      "\n===== MEMÓRIA / CONHECIMENTO SOBRE O USUÁRIO =====\n" +
        memory +
        "\n(Use essas informações para personalizar. Não as contradiga.)"
    );
  }
  return parts.join("\n");
}

// ---------- Configurações ----------

export type AISettingsView = {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  enabled: boolean;
  hasKey: boolean;
};

export async function getAISettingsView(): Promise<AISettingsView> {
  await requireAdmin();
  const s = await prisma.aISetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    provider: s?.provider ?? "openai",
    baseUrl: s?.baseUrl ?? "",
    model: s?.model ?? "gpt-4o-mini",
    temperature: s?.temperature ?? 0.3,
    enabled: s?.enabled ?? false,
    hasKey: !!s?.apiKey,
  };
}

export async function saveAISettings(formData: FormData) {
  await requireAdmin();
  const provider = String(formData.get("provider") || "openai");
  const baseUrl = String(formData.get("baseUrl") || "").trim() || null;
  const model = String(formData.get("model") || "").trim() || "gpt-4o-mini";
  const temperature = Math.min(2, Math.max(0, Number(formData.get("temperature") || 0.3)));
  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const apiKeyRaw = String(formData.get("apiKey") || "");

  // Só sobrescreve a chave se um novo valor (não-mascarado) foi enviado.
  const data: any = { provider, baseUrl, model, temperature, enabled };
  if (apiKeyRaw && !apiKeyRaw.startsWith("•")) data.apiKey = apiKeyRaw.trim();

  await prisma.aISetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data, apiKey: data.apiKey ?? null },
    update: data,
  });
  revalidatePath("/assistente");
}

export async function testAIConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const s = await getAISettings();
  if (!s) return { ok: false, message: "Configuração não encontrada. Salve antes de testar." };
  if (!s.apiKey) return { ok: false, message: "Informe a chave de API antes de testar." };
  return testConnection(s);
}

// ---------- Chat ----------

export type ChatSendResult =
  | { ok: true; conversationId: string; answer: string; tokens: number }
  | { ok: false; error: string };

export async function sendChatMessage(
  conversationId: string | null,
  content: string
): Promise<ChatSendResult> {
  await requireAdmin();
  const text = content.trim();
  if (!text) return { ok: false, error: "Mensagem vazia." };

  let settings: AISettings;
  try {
    settings = await requireConfigured();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  // Garante conversa
  let convId = conversationId;
  if (!convId) {
    const conv = await prisma.aIConversation.create({
      data: { title: text.slice(0, 60) },
    });
    convId = conv.id;
  }

  // Histórico (últimas N) + nova mensagem
  const history = await prisma.aIMessage.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
  });
  const messages: ChatMsg[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: text },
  ];

  let result;
  try {
    const system = await buildSystemPrompt();
    result = await chatComplete({ settings, system, messages });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao consultar a IA." };
  }

  // Persiste as duas mensagens
  await prisma.aIMessage.create({
    data: { conversationId: convId, role: "user", content: text },
  });
  await prisma.aIMessage.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content: result.text,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
    },
  });
  await prisma.aIConversation.update({
    where: { id: convId },
    data: { updatedAt: new Date() },
  });

  revalidatePath("/assistente");
  return {
    ok: true,
    conversationId: convId,
    answer: result.text,
    tokens: result.usage.promptTokens + result.usage.completionTokens,
  };
}

export async function clearConversation(conversationId: string) {
  await requireAdmin();
  await prisma.aIConversation.delete({ where: { id: conversationId } });
  revalidatePath("/assistente");
}

// ---------- Análise sob demanda ----------

export type InsightsResult = { ok: true; report: string; tokens: number } | { ok: false; error: string };

export async function generateInsights(): Promise<InsightsResult> {
  await requireAdmin();
  let settings: AISettings;
  try {
    settings = await requireConfigured();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }

  const prompt = `Gere um RELATÓRIO PERSONALIZADO do meu momento financeiro, em markdown, com EXATAMENTE estas seções:
## Resumo
## Alertas
## Dicas práticas
## Boas práticas
## Próximos passos
Use os números reais do retrato financeiro. Seja específico e priorize o que tem mais impacto. No fim, em uma linha começando com "MEMÓRIAS:", liste de 1 a 3 padrões/fatos duráveis sobre meus hábitos (separados por "|") que valem guardar para personalizar futuras análises.`;

  let result;
  try {
    const system = await buildSystemPrompt();
    result = await chatComplete({
      settings,
      system,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1500,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar análise." };
  }

  // Extrai memórias automáticas da última linha "MEMÓRIAS: a | b | c"
  let report = result.text;
  const memMatch = report.match(/MEM[ÓO]RIAS?:\s*(.+)\s*$/i);
  if (memMatch) {
    report = report.slice(0, memMatch.index).trim();
    const items = memMatch[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
    for (const content of items) {
      await prisma.aIMemory.create({ data: { kind: "pattern", content, source: "auto" } });
    }
  }

  revalidatePath("/assistente");
  return { ok: true, report, tokens: result.usage.promptTokens + result.usage.completionTokens };
}

// ---------- Memória / base de conhecimento ----------

export async function addMemory(formData: FormData) {
  await requireAdmin();
  const content = String(formData.get("content") || "").trim();
  const kind = String(formData.get("kind") || "note");
  if (!content) return;
  await prisma.aIMemory.create({ data: { content, kind, source: "manual" } });
  revalidatePath("/assistente");
}

export async function deleteMemory(id: string) {
  await requireAdmin();
  await prisma.aIMemory.delete({ where: { id } });
  revalidatePath("/assistente");
}

export async function toggleMemoryPin(id: string) {
  await requireAdmin();
  const m = await prisma.aIMemory.findUnique({ where: { id } });
  if (!m) return;
  await prisma.aIMemory.update({ where: { id }, data: { pinned: !m.pinned } });
  revalidatePath("/assistente");
}
