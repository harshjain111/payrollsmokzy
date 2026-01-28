import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Amount } from '@/components/ui/amount';
import type { Expense, PaymentMode } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

interface ReimburseExpenseDialogProps {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
};

export function ReimburseExpenseDialog({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: ReimburseExpenseDialogProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');

  const handleReimburse = async () => {
    try {
      setIsSubmitting(true);

      // Generate voucher number
      const { data: voucherData, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: 'expense' });

      if (voucherError) throw voucherError;

      // Create ledger entry
      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          staff_id: expense.staff_id,
          voucher_type: 'expense',
          voucher_no: voucherData,
          entry_date: new Date().toISOString().split('T')[0],
          description: `Expense reimbursement: ${expense.description}`,
          debit: 0,
          credit: expense.amount,
          tag: 'expense',
          payment_mode: paymentMode,
          paid_by: user?.id,
          approved_by: expense.approved_by,
          is_immutable: true,
          created_by: user?.id,
        })
        .select()
        .single();

      if (ledgerError) throw ledgerError;

      // Update expense status
      const { error: expenseError } = await supabase
        .from('expenses')
        .update({
          status: 'reimbursed',
          reimbursed_at: new Date().toISOString(),
          reimbursed_by: user?.id,
          ledger_entry_id: ledgerEntry.id,
        })
        .eq('id', expense.id);

      if (expenseError) throw expenseError;

      // TODO: Create notification for staff

      toast({
        title: 'Expense reimbursed',
        description: `${expense.staff?.full_name} has been reimbursed ₹${expense.amount.toLocaleString('en-IN')}.`,
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error reimbursing expense:', error);
      toast({
        title: 'Error',
        description: 'Failed to reimburse expense. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reimburse Expense</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              <div className="bg-muted p-3 rounded-md space-y-1 text-foreground">
                <p><strong>Staff:</strong> {expense.staff?.full_name}</p>
                <p><strong>Category:</strong> {EXPENSE_CATEGORY_LABELS[expense.category]}</p>
                <p><strong>Description:</strong> {expense.description}</p>
                <p className="flex items-center gap-2">
                  <strong>Amount to Reimburse:</strong> 
                  <Amount value={expense.amount} size="lg" />
                </p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Payment Mode *</Label>
          <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as PaymentMode)}>
            <SelectTrigger>
              <SelectValue placeholder="Select payment mode" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PAYMENT_MODE_LABELS) as PaymentMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {PAYMENT_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleReimburse}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Processing...' : 'Confirm Reimbursement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
