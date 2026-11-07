import paths from "./icon-paths.json";

// Paths from Font Awesome Free 5.8.1 (CC BY 4.0, https://fontawesome.com/license/free).
export type IconName = keyof typeof paths;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  const { w, h, d } = paths[name];
  return (
    <svg
      className="icon"
      viewBox={`0 0 ${w} ${h}`}
      width={`${w / h}em`}
      height="1em"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}
