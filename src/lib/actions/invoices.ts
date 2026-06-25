"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseBRL } from "@/lib/format";

export async function payInvoice(formData: FormData) {
  const id = String(formData.get("id"));
  const amount = parseBRL(String(formData.get("amount") || "0"));
  const inv = await prisma.creditCardInvoice.findUnique({ where: { id } });
  if (!inv) return;
  const newPaid = inv.paid + amount;
  let status = "parcial";
  if (newPaid >= inv.total) status = "paga";
  if (newPaid <= 0) status = inv.status;
  await prisma.creditCardInvoice.update({
    where: { id },
    data: { paid: newPaid, status },
  });
  revalidatePath("/importar");
  revalidatePath("/dashboard");
}

export async function setInvoiceStatus(id: string, status: string) {
  await prisma.creditCardInvoice.update({ where: { id }, data: { status } });
  revalidatePath("/importar");
}
