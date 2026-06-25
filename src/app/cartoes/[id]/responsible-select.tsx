"use client";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setTransactionResponsible } from "@/lib/actions/transactions";

export function ResponsibleSelect({
  txId,
  value,
  people,
}: {
  txId: string;
  value: string | null;
  people: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value || null;
        start(() => setTransactionResponsible(txId, next));
      }}
      className="h-8 text-sm"
    >
      <option value="">—</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
