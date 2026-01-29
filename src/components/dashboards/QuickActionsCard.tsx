import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LucideIcon, Zap } from 'lucide-react';

export interface QuickAction {
  label: string;
  description: string;
  icon: LucideIcon;
  href: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'muted';
  badge?: number | string;
  badgeVariant?: 'default' | 'destructive' | 'success';
}

interface QuickActionsCardProps {
  actions: QuickAction[];
  title?: string;
  description?: string;
}

const variantStyles = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary text-secondary-foreground',
  accent: 'bg-accent/50 text-accent-foreground',
  muted: 'bg-muted text-muted-foreground',
};

const badgeVariantStyles = {
  default: 'bg-primary/20 text-primary',
  destructive: 'bg-destructive text-destructive-foreground',
  success: 'bg-emerald-500/20 text-emerald-600',
};

export function QuickActionsCard({
  actions,
  title = 'Quick Actions',
  description = 'Common tasks and shortcuts',
}: QuickActionsCardProps) {
  return (
    <Card className="rounded-2xl shadow-card border-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {actions.map((action) => (
          <Link key={action.href} to={action.href}>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all"
            >
              <div
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center mr-3 shrink-0',
                  variantStyles[action.variant || 'primary']
                )}
              >
                <action.icon className="h-5 w-5" />
              </div>
              <div className="text-left flex-1 min-w-0">
                <p className="font-medium">{action.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {action.description}
                </p>
              </div>
              {action.badge !== undefined && (typeof action.badge === 'string' || action.badge > 0) && (
                <Badge
                  className={cn(
                    'text-xs ml-2 shrink-0',
                    badgeVariantStyles[action.badgeVariant || 'default']
                  )}
                >
                  {action.badge}
                </Badge>
              )}
            </Button>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
