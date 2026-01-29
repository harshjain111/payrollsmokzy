import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Amount } from '@/components/ui/amount';
import { cn } from '@/lib/utils';
import { LucideIcon, ChevronRight, PartyPopper } from 'lucide-react';

export interface ActionTileProps {
  title: string;
  count: number;
  subtitle?: string;
  amount?: number;
  icon: LucideIcon;
  href: string;
  variant?: 'default' | 'warning' | 'success' | 'info';
  emptyMessage?: string;
  showAmountWhenZero?: boolean;
}

const variantStyles = {
  default: {
    iconBg: 'bg-muted',
    iconColor: 'text-muted-foreground',
    badge: 'bg-muted text-muted-foreground',
  },
  warning: {
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    badge: 'bg-destructive text-destructive-foreground',
  },
  success: {
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600',
    badge: 'bg-emerald-500/10 text-emerald-600',
  },
  info: {
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    badge: 'bg-primary/10 text-primary',
  },
};

export function ActionTile({
  title,
  count,
  subtitle,
  amount,
  icon: Icon,
  href,
  variant = 'default',
  emptyMessage = 'All caught up 🎉',
  showAmountWhenZero = false,
}: ActionTileProps) {
  const navigate = useNavigate();
  const isEmpty = count === 0;
  const styles = isEmpty ? variantStyles.default : variantStyles[variant];

  const handleClick = () => {
    if (!isEmpty) {
      navigate(href);
    }
  };

  return (
    <Card
      className={cn(
        'rounded-2xl shadow-card border-0 transition-all duration-200',
        isEmpty
          ? 'opacity-60 cursor-default'
          : 'cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]'
      )}
      onClick={handleClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className={cn('p-3 rounded-xl shrink-0', styles.iconBg)}>
              <Icon className={cn('h-6 w-6', styles.iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-muted-foreground truncate">
                {title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                {isEmpty ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <PartyPopper className="h-4 w-4" />
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                ) : (
                  <>
                    <span className="text-2xl font-bold">{count}</span>
                    {!isEmpty && (
                      <Badge className={cn('text-xs', styles.badge)}>
                        Action needed
                      </Badge>
                    )}
                  </>
                )}
              </div>
              {subtitle && !isEmpty && (
                <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {(amount !== undefined && (count > 0 || showAmountWhenZero)) && (
              <Amount 
                value={amount} 
                size="sm" 
                className={cn(
                  'font-semibold',
                  isEmpty ? 'text-muted-foreground' : ''
                )} 
              />
            )}
            {!isEmpty && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Click to view <ChevronRight className="h-3 w-3" />
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
