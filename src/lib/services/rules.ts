import { prisma } from "@/lib/prisma";

export type RuleInput = {
  description: string;
  cardId?: string | null;
  amount: number;
};

export type RuleEffect = {
  categoryId?: string | null;
  responsibleId?: string | null;
  belongsTo?: string | null;
  reimbursable?: boolean | null;
  status?: string | null;
};

export async function applyRules(input: RuleInput): Promise<RuleEffect> {
  const rules = await prisma.categorizationRule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  const desc = (input.description || "").toUpperCase();
  const effect: RuleEffect = {};

  for (const r of rules) {
    let matches = true;

    if (r.descriptionContains) {
      matches = matches && desc.includes(r.descriptionContains.toUpperCase());
    }
    if (r.cardId) {
      matches = matches && input.cardId === r.cardId;
    }
    if (r.amountGreaterThan != null) {
      matches = matches && input.amount > r.amountGreaterThan;
    }
    if (r.amountLessThan != null) {
      matches = matches && input.amount < r.amountLessThan;
    }

    if (!matches) continue;

    if (r.categoryId && effect.categoryId == null) effect.categoryId = r.categoryId;
    if (r.belongsTo && effect.belongsTo == null) effect.belongsTo = r.belongsTo;
    if (r.reimbursable != null && effect.reimbursable == null) effect.reimbursable = r.reimbursable;
    if (r.status && effect.status == null) effect.status = r.status;
    if (r.responsibleName && effect.responsibleId == null) {
      const p = await prisma.person.findUnique({ where: { name: r.responsibleName } });
      if (p) effect.responsibleId = p.id;
    }
  }

  return effect;
}
