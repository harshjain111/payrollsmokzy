import * as React from "react";
import { cn } from "@/lib/utils";

interface AmountProps {
  value: number;
  currency?: string;
  showSign?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** When true, don't apply the green/red/grey sign colours so the parent's colour shows through. */
  neutral?: boolean;
}

export function Amount({ 
  value, 
  currency = '₹', 
  showSign = false,
  className,
  size = 'md',
  neutral = false,
}: AmountProps) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const displayValue = Math.abs(value);

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  const formattedValue = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(displayValue);

  return (
    <span
      className={cn(
        'font-mono tabular-nums font-medium',
        sizeClasses[size],
        !neutral && isPositive && 'text-success',
        !neutral && isNegative && 'text-destructive',
        !neutral && !isPositive && !isNegative && 'text-muted-foreground',
        className
      )}
    >
      {showSign && isPositive && '+'}
      {showSign && isNegative && '-'}
      {currency}{formattedValue}
    </span>
  );
}

interface AmountInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className'> {
  value: number;
  onChange: (value: number) => void;
  currency?: string;
  /** Applied to the wrapper (kept for backwards compatibility). */
  className?: string;
  inputClassName?: string;
}

/**
 * Keep only digits and a single decimal point, with at most 2 decimal places.
 * Returns the cleaned text exactly as the user should see it (e.g. "12." stays "12.").
 */
export function sanitizeAmountText(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const fraction = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${whole}.${fraction}`;
}

export function parseAmountText(text: string): number {
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  {
    value,
    onChange,
    currency = '₹',
    placeholder = '0.00',
    className,
    inputClassName,
    disabled = false,
    ...inputProps
  },
  ref,
) {
  // Keep the raw text locally so intermediate states like "12." or "12.0" survive re-renders.
  const [text, setText] = React.useState(() => (value > 0 ? String(value) : ''));

  // Sync when the parent changes the value (e.g. form reset), but never clobber what the user typed.
  React.useEffect(() => {
    setText((prev) => (parseAmountText(prev) === value ? prev : value > 0 ? String(value) : ''));
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeAmountText(e.target.value);
    setText(next);
    onChange(parseAmountText(next));
  };

  return (
    <div className={cn('relative', className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
        {currency}
      </span>
      <input
        {...inputProps}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2',
          'font-mono tabular-nums text-right',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'placeholder:text-muted-foreground',
          inputClassName
        )}
      />
    </div>
  );
});
