interface LogoProps {
  className?: string;
  showWordmark?: boolean;
}

/**
 * Forge logo — a geometric "F" built from a barbell-plate motif.
 * Monochrome, uses currentColor for the mark background elements and
 * the primary accent for the F glyph so it adapts across themes.
 */
export function Logo({ className = "", showWordmark = true }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid="logo-forge">
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        aria-label="Forge logo"
        role="img"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" className="fill-foreground" />
        <path
          d="M9 7H24V11.5H14.5V14.5H21.5V19H14.5V25H9V7Z"
          className="fill-primary"
        />
      </svg>
      {showWordmark && (
        <span className="font-display font-bold text-lg tracking-tight leading-none">
          FORGE
        </span>
      )}
    </div>
  );
}
