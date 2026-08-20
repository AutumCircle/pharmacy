export default function OrdersIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5.5 8.5h13l-1 12h-11l-1-12Z" strokeLinejoin="round" />
      <path d="M9 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
      <path d="M9 13h6" strokeLinecap="round" />
    </svg>
  );
}
