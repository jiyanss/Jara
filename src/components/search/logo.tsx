interface LogoProps {
  /** Tailwind font size classes, e.g. "text-6xl" or "text-2xl" */
  size?: string;
  className?: string;
}

/**
 * "Ara!" wordmark in Google brand colors — the user explicitly requested a
 * Google-style search engine, so the classic multicolor palette is used here.
 */
export function Logo({ size = "text-6xl", className = "" }: LogoProps) {
  return (
    <span
      aria-label="Ara!"
      role="img"
      className={`select-none font-bold leading-none tracking-tight ${size} ${className}`}
    >
      <span className="text-[#4285F4]">A</span>
      <span className="text-[#EA4335]">r</span>
      <span className="text-[#F4B400]">a</span>
      <span className="text-[#34A853]">!</span>
    </span>
  );
}
