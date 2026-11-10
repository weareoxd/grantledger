import { cn } from "cn";

/** The OXD mark */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 84"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden="true"
      className={cn("h-3.5 w-auto", className)}
    >
      <path d="M280 2h-36v80h36c22.09 0 40-17.91 40-40S302.09 2 280 2z" />
      <circle cx="42" cy="42" r="42" />
      <path d="m116 2 40 40-40 40h88l-40-40 40-40z" />
    </svg>
  );
}
