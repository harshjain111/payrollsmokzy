import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: StatCardProps) {
  const variantStyles = {
    default: 'bg-card border border-border',
    primary: 'bg-primary text-primary-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
  };

  const iconContainerStyles = {
    default: 'bg-secondary text-foreground',
    primary: 'bg-primary-foreground/20 text-primary-foreground',
    success: 'bg-success-foreground/20 text-success-foreground',
    warning: 'bg-warning-foreground/20 text-warning-foreground',
    destructive: 'bg-destructive-foreground/20 text-destructive-foreground',
  };

  const subtitleStyles = {
    default: 'text-muted-foreground',
    primary: 'text-primary-foreground/70',
    success: 'text-success-foreground/70',
    warning: 'text-warning-foreground/70',
    destructive: 'text-destructive-foreground/70',
  };

  return (
    <div
      className={cn(
        'rounded-lg p-6 shadow-card transition-shadow hover:shadow-card-hover',
        variantStyles[variant],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className={cn(
            'text-sm font-medium',
            variant === 'default' ? 'text-muted-foreground' : subtitleStyles[variant]
          )}>
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {value}
          </p>
          {subtitle && (
            <p className={cn('mt-1 text-sm', subtitleStyles[variant])}>
              {subtitle}
            </p>
          )}
          {trend && (
            <div className="mt-2 flex items-center gap-1 text-sm">
              <span className={cn(
                'font-medium',
                trend.value >= 0 ? 'text-success' : 'text-destructive'
              )}>
                {trend.value >= 0 ? '+' : ''}{trend.value}%
              </span>
              <span className={subtitleStyles[variant]}>{trend.label}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn(
            'rounded-lg p-3',
            iconContainerStyles[variant]
          )}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </div>
  );
}
