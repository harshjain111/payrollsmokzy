import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Inline "couldn't load" state with Retry — used instead of an empty state when a fetch fails. */
export function LoadError({
  message = "Couldn't load this. Check your internet connection and try again.",
  onRetry,
  className,
}: Props) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <AlertCircle className="h-8 w-8 text-destructive" />
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}
