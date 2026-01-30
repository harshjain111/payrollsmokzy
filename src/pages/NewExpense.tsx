import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AmountInput } from '@/components/ui/amount';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Upload, ArrowLeft, Send, Save } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { ExpenseCategory } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

export default function NewExpense() {
  const navigate = useNavigate();
  const { user, staffData } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState<Date>(new Date());
  const [proofFile, setProofFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'Please select a file smaller than 5MB',
          variant: 'destructive',
        });
        return;
      }
      setProofFile(file);
    }
  };

  const uploadProof = async (): Promise<string | null> => {
    if (!proofFile || !user) return null;

    const fileExt = proofFile.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('expense-proofs')
      .upload(fileName, proofFile);

    if (error) {
      console.error('Error uploading proof:', error);
      throw new Error('Failed to upload proof');
    }

    return data.path;
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!staffData) {
      toast({
        title: 'Error',
        description: 'Staff data not found',
        variant: 'destructive',
      });
      return;
    }

    if (amount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid expense amount',
        variant: 'destructive',
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: 'Description required',
        description: 'Please provide a description for the expense',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSubmitting(true);

      // Upload proof if present
      let proofUrl: string | null = null;
      if (proofFile) {
        proofUrl = await uploadProof();
      }

      const { data: newExpense, error } = await supabase
        .from('expenses')
        .insert({
          staff_id: staffData.id,
          amount,
          category,
          description: description.trim(),
          expense_date: format(expenseDate, 'yyyy-MM-dd'),
          proof_url: proofUrl,
          status: asDraft ? 'draft' as const : 'pending' as const,
          submitted_at: asDraft ? null : new Date().toISOString(),
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Notify Owner and Admin about new expense submission
      if (!asDraft && newExpense) {
        const { data: approvers } = await supabase
          .from('user_roles')
          .select('user_id')
          .in('role', ['owner', 'admin']);

        if (approvers) {
          for (const approver of approvers) {
            if (approver.user_id !== user?.id) {
              await supabase.rpc('create_notification', {
                _user_id: approver.user_id,
                _title: 'New Expense Submitted',
                _message: `${staffData.full_name} has submitted an expense of ₹${amount.toLocaleString('en-IN')} for "${description.slice(0, 50)}${description.length > 50 ? '...' : ''}"`,
                _type: 'info',
                _reference_type: 'expense',
                _reference_id: newExpense.id,
              });
            }
          }
        }
      }

      toast({
        title: asDraft ? 'Expense saved as draft' : 'Expense submitted',
        description: asDraft 
          ? 'Your expense has been saved. You can submit it later.'
          : 'Your expense has been submitted for approval.',
      });

      navigate('/expenses');
    } catch (error) {
      console.error('Error creating expense:', error);
      toast({
        title: 'Error',
        description: 'Failed to create expense. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="New Expense"
        description="Record an expense for reimbursement"
      >
        <Button variant="ghost" size="sm" onClick={() => navigate('/expenses')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>
      </PageHeader>

      <Card className="max-w-2xl">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Expense Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6 p-4 sm:p-6 pt-0 sm:pt-0">
          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount" className="text-sm">Amount *</Label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              className="h-12 text-lg"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category" className="text-sm">Category *</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {EXPENSE_CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Expense Date */}
          <div className="space-y-2">
            <Label className="text-sm">Expense Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal h-11',
                    !expenseDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expenseDate ? format(expenseDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expenseDate}
                  onSelect={(date) => date && setExpenseDate(date)}
                  disabled={(date) => date > new Date()}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm">Description *</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the expense (e.g., Cab fare for client meeting)"
              rows={3}
              className="text-base"
            />
          </div>

          {/* Proof Upload */}
          <div className="space-y-2">
            <Label htmlFor="proof" className="text-sm">Proof / Receipt (optional)</Label>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <Input
                id="proof"
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="cursor-pointer h-11"
              />
              {proofFile && (
                <span className="text-xs sm:text-sm text-muted-foreground truncate max-w-[200px]">
                  {proofFile.name}
                </span>
              )}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Upload a receipt or proof (max 5MB, images or PDF)
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2 sm:pt-4">
            <Button
              variant="outline"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
              className="flex-1 h-11"
            >
              <Save className="mr-1.5 h-4 w-4" />
              <span className="text-sm">Save as Draft</span>
            </Button>
            <Button
              onClick={() => handleSubmit(false)}
              disabled={isSubmitting}
              className="flex-1 h-11"
            >
              <Send className="mr-1.5 h-4 w-4" />
              <span className="text-sm">Submit for Approval</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
