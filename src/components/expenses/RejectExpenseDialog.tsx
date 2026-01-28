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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Amount } from '@/components/ui/amount';
import type { Expense } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

interface RejectExpenseDialogProps {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RejectExpenseDialog({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: RejectExpenseDialogProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState('');

  const handleReject = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason for rejection.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSubmitting(true);

      const { error } = await supabase
        .from('expenses')
        .update({
          status: 'rejected',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: reason.trim(),
        })
        .eq('id', expense.id);

      if (error) throw error;

      // TODO: Create notification for staff

      toast({
        title: 'Expense rejected',
        description: 'The expense has been rejected.',
      });

      setReason('');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error rejecting expense:', error);
      toast({
        title: 'Error',
        description: 'Failed to reject expense. Please try again.',
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
          <DialogTitle>Reject Expense</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3">
              <div className="bg-muted p-3 rounded-md space-y-1 text-foreground">
                <p><strong>Staff:</strong> {expense.staff?.full_name}</p>
                <p><strong>Category:</strong> {EXPENSE_CATEGORY_LABELS[expense.category]}</p>
                <p><strong>Description:</strong> {expense.description}</p>
                <p className="flex items-center gap-2">
                  <strong>Amount:</strong> 
                  <Amount value={expense.amount} />
                </p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="reason">Rejection Reason *</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Provide a reason for rejection..."
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            variant="destructive"
            onClick={handleReject}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Rejecting...' : 'Reject Expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
