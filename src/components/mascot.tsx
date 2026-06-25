import { cn } from "@/lib/utils";

/**
 * Marca Bugia Finance — assets em /public/brand.
 * Símbolo "B" hexagonal = logo. Mascote "Bugia" (pato Old Money) = personagem/assistente.
 */

/** Símbolo "B" hexagonal (logo primária — sidebar, login, favicon). */
export function BugiaSymbol({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/symbol.svg"
      alt="Bugia Finance"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

/** Avatar do mascote (rosto) — ideal para avatares pequenos (Assistente). */
export function BugiaAvatar({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/brand/mascot/avatar.png"
      alt="Bugia"
      width={size}
      height={size}
      className={cn("shrink-0 select-none object-contain", className)}
      draggable={false}
    />
  );
}

/**
 * Mascote principal — Bugia com o tablet de analytics (pose herói).
 * Usado no login, empty states e destaques.
 */
export function BugiaMascot({
  width = 180,
  pose = "hero",
  className,
}: {
  width?: number;
  pose?: "hero" | "welcome" | "full";
  className?: string;
}) {
  const src =
    pose === "welcome"
      ? "/brand/mascot/welcome.png"
      : pose === "full"
        ? "/brand/mascot/full.png"
        : "/brand/mascot/hero.png";
  return (
    <img
      src={src}
      alt="Bugia — seu copiloto financeiro"
      width={width}
      className={cn("select-none object-contain", className)}
      draggable={false}
    />
  );
}

/** Alias de compatibilidade. */
export const BugiaMascotFull = BugiaMascot;
