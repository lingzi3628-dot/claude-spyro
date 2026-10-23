/**
 * The Spyro mark — a stylised dragon head drawn as flat geometry so it stays
 * crisp at small sizes (sidebar, favicon, welcome screen).
 * Inherits `currentColor`, so it picks up the theme accent.
 */
export function DragonMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Spyro dragon"
    >
      {/* head + horn + neck silhouette */}
      <path
        d="M28.5 13.2 22 11.1 16.2 10 18.6 3.6 13 9.1 8 11.2 6 17.4 10 20.6 18 19.4 24.4 17.2Z"
        fill="currentColor"
      />
      {/* eye */}
      <circle cx="19.3" cy="12.4" r="1.15" fill="var(--bg-sidebar, #1f1e1d)" />
      {/* nostril */}
      <circle cx="25.4" cy="13.6" r="0.7" fill="var(--bg-sidebar, #1f1e1d)" opacity="0.75" />
    </svg>
  );
}