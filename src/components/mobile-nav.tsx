"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ArrowDownToLine,
  PiggyBank,
  Receipt,
  Settings2,
  Users,
} from "lucide-react";

const adminItems = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/receitas", label: "Receitas", icon: ArrowDownToLine },
  { href: "/caixa", label: "Caixa", icon: PiggyBank },
  { href: "/transacoes", label: "Mov.", icon: Receipt },
  { href: "/configuracoes", label: "Mais", icon: Settings2 },
];

const userItems = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/transacoes", label: "Mov.", icon: Receipt },
  { href: "/pessoas", label: "Eu", icon: Users },
];

export function MobileNav({
  user,
}: {
  user?: { role: "ADMIN" | "USER" } | null;
}) {
  const path = usePathname();
  const items = user?.role === "USER" ? userItems : adminItems;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex justify-around p-1.5 z-40">
      {items.map((it) => {
        const Icon = it.icon;
        const active = path === it.href || path?.startsWith(it.href + "/");
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-0.5 text-[10px] py-1.5 rounded-md transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
