import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import type { PaymentMode } from '@/types/database';

interface PaymentDetails {
  paymentType: 'salary' | 'advance' | 'expense';
  staffName: string;
  employeeId: string;
  amount: number;
  paymentMode: PaymentMode;
  referenceMonth?: string;
  description?: string;
  expenseCategory?: string;
}

interface PaymentConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  details: PaymentDetails | null;
  isLoading?: boolean;
}

const PAYMENT_TYPE_LABELS = {
  salary: 'Salary Payment',
  advance: 'Advance Payment',
  expense: 'Expense Reimbursement',
};

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
};

export function PaymentConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  details,
  isLoading = false,
}: PaymentConfirmDialogProps) {
  if (!details) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            Confirm Payment
            <Badge variant="outline" className="font-normal">
              {PAYMENT_TYPE_LABELS[details.paymentType]}
            </Badge>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-muted p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Staff</span>
                  <span className="font-medium text-foreground">
                    {details.staffName} ({details.employeeId})
                  </span>
                </div>
                
                <Separator />
                
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Amount</span>
                  <Amount value={details.amount} size="lg" className="text-foreground" />
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Payment Mode</span>
                  <span className="text-foreground">
                    {PAYMENT_MODE_LABELS[details.paymentMode]}
                  </span>
                </div>
                
                {details.referenceMonth && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Reference Month</span>
                    <span className="text-foreground">
                      {format(new Date(details.referenceMonth + '-01'), 'MMMM yyyy')}
                    </span>
                  </div>
                )}
                
                {details.expenseCategory && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Category</span>
                    <span className="text-foreground">{details.expenseCategory}</span>
                  </div>
                )}
                
                {details.description && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground text-sm">Description</span>
                      <p className="text-foreground mt-1 text-sm">{details.description}</p>
                    </div>
                  </>
                )}
                
                <Separator />
                
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <span className="text-foreground">
                    {format(new Date(), 'dd MMM yyyy, hh:mm a')}
                  </span>
                </div>
              </div>
              
              <p className="text-sm text-muted-foreground">
                This action will create a ledger entry and cannot be undone.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Processing...' : 'Confirm Payment'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
