import { useState } from 'react';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Amount } from '@/components/ui/amount';
import type { Expense } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

interface ApproveExpenseDialogProps {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function ApproveExpenseDialog({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: ApproveExpenseDialogProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleApprove = async () => {
    try {
      setIsSubmitting(true);

      const { error } = await supabase
        .from('expenses')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', expense.id);

      if (error) throw error;

      // TODO: Create notification for accountant

      toast({
        title: 'Expense approved',
        description: 'The expense has been approved for reimbursement.',
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error approving expense:', error);
      toast({
        title: 'Error',
        description: 'Failed to approve expense. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve Expense</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Are you sure you want to approve this expense?</p>
              <div className="bg-muted p-3 rounded-md space-y-1">
                <p><strong>Staff:</strong> {expense.staff?.full_name}</p>
                <p><strong>Category:</strong> {EXPENSE_CATEGORY_LABELS[expense.category]}</p>
                <p><strong>Description:</strong> {expense.description}</p>
                <p className="flex items-center gap-2">
                  <strong>Amount:</strong> 
                  <Amount value={expense.amount} />
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Once approved, the accountant can proceed with reimbursement.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleApprove}
            disabled={isSubmitting}
            className="bg-success hover:bg-success/90"
          >
            {isSubmitting ? 'Approving...' : 'Approve'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
