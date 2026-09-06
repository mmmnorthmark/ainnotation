// Inline SVG icons, reproduced faithfully from the Tableau icon set at the sizes
// this UI uses. Kept inline so the project carries no dependency on a private
// icon package and builds anywhere. Each accepts a `size` and scales via viewBox.

interface IconProps {
  size?: number;
}

export function StatusActiveIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="1" y="0.999" width="16" height="16" rx="1" fill="#22683e" />
      <path
        d="m13.232 5.45-4.3 7.4a.501.501 0 0 1-.763.124l-3.5-3.101.662-.748 3.043 2.694 3.994-6.87.864.501Z"
        fill="#FFFFFE"
        fillOpacity=".933"
      />
    </svg>
  );
}

export function StatusErrorIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="1" y="1" width="16" height="16" rx="1" fill="#ba0517" />
      <g fill="#FFFFFE" fillOpacity=".933">
        <path d="M9.5 13.2h-1v-.8h1v.8ZM9.5 11.6h-1V4.806h1V11.6Z" />
      </g>
    </svg>
  );
}

export function NotificationInfoOutlineIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <g fill="currentColor">
        <path d="M9 6V5H8v1h1ZM9 12V7H8v5h1Z" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M16 8.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Zm-1 0a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
        />
      </g>
    </svg>
  );
}

export function ClearBaseIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="m12.314 1 .707.707L7.717 7.01l5.304 5.304-.707.707L7.01 7.717l-5.303 5.304L1 12.314 6.303 7.01 1 1.707 1.707 1 7.01 6.303 12.314 1Z"
        fill="currentColor"
      />
    </svg>
  );
}
