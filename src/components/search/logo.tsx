import Image from "next/image";

interface LogoProps {
  /** Height classes for the logo, e.g. "h-[72px]" or "h-6 md:h-8" */
  className?: string;
}

/**
 * "Jara!" wordmark — user-provided multicolor logo with a transparent
 * background so it renders correctly on both light and dark themes.
 * Set the desired size via className (height + w-auto keeps the aspect ratio).
 */
export function Logo({ className = "" }: LogoProps) {
  return (
    <Image
      src="/jara-logo.png"
      alt="Jara!"
      width={560}
      height={192}
      priority
      draggable={false}
      className={`w-auto select-none ${className}`}
    />
  );
}
