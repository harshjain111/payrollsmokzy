import { cn } from "@/lib/utils";
import { RequestStatus, SettlementStatus, ExpenseStatus } from "@/types/database";
import { ReactNode } from "react";

type StatusType = RequestStatus | SettlementStatus | ExpenseStatus | 'active' | 'inactive';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info';

interface StatusBadgeProps {
  status: StatusType;
  variant?: BadgeVariant;
  className?: string;
  children?: ReactNode;
}

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  approved: {
    label: 'Approved',
    className: 'bg-success/10 text-success border-success/20',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  settled: {
    label: 'Settled',
    className: 'bg-success/10 text-success border-success/20',
  },
  active: {
    label: 'Active',
    className: 'bg-success/10 text-success border-success/20',
  },
  inactive: {
    label: 'Inactive',
    className: 'bg-muted text-muted-foreground border-border',
  },
  draft: {
    label: 'Draft',
    className: 'bg-muted text-muted-foreground border-border',
  },
  reimbursed: {
    label: 'Reimbursed',
    className: 'bg-success/10 text-success border-success/20',
  },
};

const variantConfig: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-muted text-muted-foreground border-border',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  destructive: 'bg-destructive/10 text-destructive border-destructive/20',
  info: 'bg-info/10 text-info border-info/20',
};

export function StatusBadge({ status, variant, className, children }: StatusBadgeProps) {
  const config = statusConfig[status];
  const variantClass = variant ? variantConfig[variant] : config?.className;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantClass,
        className
      )}
    >
      {children || config?.label || status}
    </span>
  );
}
