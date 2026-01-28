import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AmountInput, Amount } from '@/components/ui/amount';
import { 
  ArrowLeft, 
  CreditCard, 
  AlertCircle, 
  Wallet, 
  Receipt, 
  Banknote,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { PaymentConfirmDialog } from '@/components/payments/PaymentConfirmDialog';
import { StaffFinancialSummary } from '@/components/payments/StaffFinancialSummary';
import type { Staff, PaymentMode, VoucherType, Expense, ExpenseCategory } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

type PaymentType = 'salary' | 'advance' | 'expense';

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

const PAYMENT_TYPES = [
  { value: 'advance', label: 'Advance Payment', icon: Banknote, description: 'Pay advance to staff' },
  { value: 'salary', label: 'Salary Payment', icon: Wallet, description: 'Record salary payment' },
  { value: 'expense', label: 'Expense Reimbursement', icon: Receipt, description: 'Reimburse approved expenses' },
] as const;

interface StaffFinancials {
  monthlySalary: number;
  advancesOutstanding: number;
  currentBalance: number;
  pendingExpenses: number;
  approvedExpensesTotal: number;
}

export default function RecordPayment() {
  const navigate = useNavigate();
  const { user, isOwner, isAccountant, isStaff } = useAuth();
  
  // Determine access
  const hasAccess = isOwner || isAccountant;
  const accessDenied = isStaff || !hasAccess;
  
  // Core state
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<PaymentType>('advance');
  const [amount, setAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [referenceMonth, setReferenceMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingFinancials, setIsLoadingFinancials] = useState(false);
  
  // Staff financial data
  const [financials, setFinancials] = useState<StaffFinancials | null>(null);
  
  // Expense-related state
  const [approvedExpenses, setApprovedExpenses] = useState<Expense[]>([]);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>('');
  
  // Unsettled months for salary
  const [unsettledMonths, setUnsettledMonths] = useState<{ value: string; label: string }[]>([]);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);
  
  // Confirmation dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Fetch staff on mount
  useEffect(() => {
    if (hasAccess) {
      fetchStaff();
    }
  }, [hasAccess]);

  // Fetch staff financials when staff selected
  useEffect(() => {
    if (!hasAccess) return;
    
    if (selectedStaffId) {
      fetchStaffFinancials();
      
      if (paymentType === 'expense') {
        fetchApprovedExpenses();
      }
      
      if (paymentType === 'salary') {
        fetchUnsettledMonths();
      }
    } else {
      setFinancials(null);
      setApprovedExpenses([]);
      setUnsettledMonths([]);
    }
  }, [selectedStaffId, paymentType, hasAccess]);

  // Reset expense selection when staff changes
  useEffect(() => {
    setSelectedExpenseId('');
    setAmount(0);
  }, [selectedStaffId, paymentType]);

  // Auto-fill amount when expense selected
  useEffect(() => {
    if (selectedExpenseId) {
      const expense = approvedExpenses.find(e => e.id === selectedExpenseId);
      if (expense) {
        setAmount(expense.amount);
      }
    }
  }, [selectedExpenseId, approvedExpenses]);

  // Generate month options for advance (moved before early return)
  const monthOptions = useMemo(() => 
    Array.from({ length: 6 }, (_, i) => {
      const date = subMonths(new Date(), i);
      return {
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy'),
      };
    }), []
  );

  // Access control - block staff and unauthorized users
  if (accessDenied) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">
          {isStaff 
            ? 'Staff members cannot record payments.' 
            : 'Only owners and accountants can record payments.'}
        </p>
        <Button onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('is_active', true)
        .order('full_name');

      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchStaffFinancials = async () => {
    try {
      setIsLoadingFinancials(true);

      // Get advances outstanding
      const { data: advanceData, error: advanceError } = await supabase
        .rpc('get_advances_outstanding', {
          _staff_id: selectedStaffId,
        });

      if (advanceError) throw advanceError;

      // Calculate current balance from ledger
      const { data: ledgerData, error: ledgerError } = await supabase
        .from('ledger_entries')
        .select('debit, credit')
        .eq('staff_id', selectedStaffId);

      if (ledgerError) throw ledgerError;

      const balance = ledgerData?.reduce((sum, entry) => {
        return sum + Number(entry.debit || 0) - Number(entry.credit || 0);
      }, 0) || 0;

      // Get approved expenses total
      const { data: expenseData, error: expenseError } = await supabase
        .from('expenses')
        .select('amount')
        .eq('staff_id', selectedStaffId)
        .eq('status', 'approved');

      if (expenseError) throw expenseError;

      const approvedTotal = expenseData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

      // Get pending expenses count
      const { data: pendingData } = await supabase
        .from('expenses')
        .select('amount')
        .eq('staff_id', selectedStaffId)
        .eq('status', 'pending');

      const pendingTotal = pendingData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

      const selectedStaff = staff.find(s => s.id === selectedStaffId);

      setFinancials({
        monthlySalary: selectedStaff?.monthly_salary || 0,
        advancesOutstanding: Number(advanceData) || 0,
        currentBalance: balance,
        pendingExpenses: pendingTotal,
        approvedExpensesTotal: approvedTotal,
      });
    } catch (error) {
      console.error('Error fetching staff financials:', error);
    } finally {
      setIsLoadingFinancials(false);
    }
  };

  const fetchApprovedExpenses = async () => {
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, staff:staff_id(*)')
        .eq('staff_id', selectedStaffId)
        .eq('status', 'approved')
        .order('expense_date', { ascending: false });

      if (error) throw error;
      setApprovedExpenses(data || []);
    } catch (error) {
      console.error('Error fetching approved expenses:', error);
    }
  };

  const fetchUnsettledMonths = async () => {
    try {
      setIsLoadingMonths(true);
      
      // Get all settled months for this staff
      const { data: settledData, error } = await supabase
        .from('salary_settlements')
        .select('settlement_month')
        .eq('staff_id', selectedStaffId)
        .eq('status', 'settled');

      if (error) throw error;

      const settledMonths = new Set(settledData?.map(s => s.settlement_month) || []);

      // Generate last 12 months and filter out settled ones
      const months = Array.from({ length: 12 }, (_, i) => {
        const date = subMonths(new Date(), i + 1); // Start from previous month
        return {
          value: format(date, 'yyyy-MM'),
          label: format(date, 'MMMM yyyy'),
        };
      }).filter(m => !settledMonths.has(m.value));

      setUnsettledMonths(months);
      
      // Set default to first unsettled month
      if (months.length > 0 && !months.find(m => m.value === referenceMonth)) {
        setReferenceMonth(months[0].value);
      }
    } catch (error) {
      console.error('Error fetching unsettled months:', error);
    } finally {
      setIsLoadingMonths(false);
    }
  };

  const validatePayment = (): boolean => {
    if (!selectedStaffId) {
      toast({ title: 'Validation Error', description: 'Please select a staff member.', variant: 'destructive' });
      return false;
    }
    
    if (amount <= 0) {
      toast({ title: 'Validation Error', description: 'Amount must be greater than 0.', variant: 'destructive' });
      return false;
    }

    if (paymentType === 'expense') {
      if (!selectedExpenseId) {
        toast({ title: 'Validation Error', description: 'Please select an expense to reimburse.', variant: 'destructive' });
        return false;
      }
      
      const expense = approvedExpenses.find(e => e.id === selectedExpenseId);
      if (!expense) {
        toast({ title: 'Validation Error', description: 'Selected expense not found.', variant: 'destructive' });
        return false;
      }
      
      if (expense.status !== 'approved') {
        toast({ title: 'Validation Error', description: 'Only approved expenses can be reimbursed.', variant: 'destructive' });
        return false;
      }
    }

    if (paymentType === 'salary') {
      if (!referenceMonth) {
        toast({ title: 'Validation Error', description: 'Please select a settlement month.', variant: 'destructive' });
        return false;
      }
      
      if (unsettledMonths.length === 0) {
        toast({ title: 'Validation Error', description: 'No unsettled months available. Use the Salary Settlement page instead.', variant: 'destructive' });
        return false;
      }
    }

    return true;
  };

  const handleSubmitClick = () => {
    if (!validatePayment()) return;
    setShowConfirmDialog(true);
  };

  const handleConfirmPayment = async () => {
    if (!validatePayment()) return;

    try {
      setIsSubmitting(true);

      let voucherType: VoucherType;
      let description: string;
      let tag: string;
      let debit = 0;
      let credit = 0;

      if (paymentType === 'advance') {
        voucherType = 'advance';
        description = notes.trim() || 'Advance payment';
        tag = 'advance';
        debit = amount; // Advance is a debit (staff owes)
      } else if (paymentType === 'salary') {
        voucherType = 'payment';
        description = notes.trim() || `Salary payment for ${format(new Date(referenceMonth + '-01'), 'MMMM yyyy')}`;
        tag = 'salary';
        credit = amount; // Payment is credit (paid to staff)
      } else {
        voucherType = 'expense';
        description = notes.trim() || `Expense reimbursement`;
        tag = 'expense';
        credit = amount; // Reimbursement is credit
      }

      // Generate voucher number
      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: voucherType });

      if (voucherError) throw voucherError;

      // Create ledger entry
      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          staff_id: selectedStaffId,
          voucher_type: voucherType,
          voucher_no: voucherNo,
          entry_date: new Date().toISOString().split('T')[0],
          description,
          debit,
          credit,
          tag,
          reference_month: paymentType === 'salary' ? referenceMonth : null,
          payment_mode: paymentMode,
          paid_by: user?.id,
          is_immutable: paymentType !== 'advance', // Only advances are mutable for adjustment
          created_by: user?.id,
        })
        .select()
        .single();

      if (ledgerError) throw ledgerError;

      // If expense reimbursement, update expense status
      if (paymentType === 'expense' && selectedExpenseId) {
        const { error: expenseError } = await supabase
          .from('expenses')
          .update({
            status: 'reimbursed',
            reimbursed_at: new Date().toISOString(),
            reimbursed_by: user?.id,
            ledger_entry_id: ledgerEntry.id,
          })
          .eq('id', selectedExpenseId);

        if (expenseError) throw expenseError;

        // Create notification for staff
        const expense = approvedExpenses.find(e => e.id === selectedExpenseId);
        if (expense?.staff?.user_id) {
          await supabase.rpc('create_notification', {
            _user_id: expense.staff.user_id,
            _title: 'Expense Reimbursed',
            _message: `Your expense of ₹${amount.toLocaleString('en-IN')} has been reimbursed.`,
            _type: 'success',
            _reference_type: 'expense',
            _reference_id: selectedExpenseId,
          });
        }
      }

      // Create notification for staff (for advance/salary)
      const selectedStaff = staff.find(s => s.id === selectedStaffId);
      if (selectedStaff?.user_id && paymentType !== 'expense') {
        const notifTitle = paymentType === 'advance' ? 'Advance Paid' : 'Salary Paid';
        const notifMessage = paymentType === 'advance' 
          ? `You have received an advance of ₹${amount.toLocaleString('en-IN')}.`
          : `Your salary payment of ₹${amount.toLocaleString('en-IN')} has been processed.`;
        
        await supabase.rpc('create_notification', {
          _user_id: selectedStaff.user_id,
          _title: notifTitle,
          _message: notifMessage,
          _type: 'success',
          _reference_type: 'ledger_entry',
          _reference_id: ledgerEntry.id,
        });
      }

      toast({
        title: 'Payment Recorded',
        description: `₹${amount.toLocaleString('en-IN')} ${paymentType} payment recorded for ${selectedStaff?.full_name}.`,
      });

      // Reset form
      setSelectedStaffId('');
      setAmount(0);
      setNotes('');
      setPaymentType('advance');
      setSelectedExpenseId('');
      setShowConfirmDialog(false);
    } catch (error: any) {
      console.error('Error recording payment:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to record payment. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedStaff = staff.find(s => s.id === selectedStaffId);
  const selectedExpense = approvedExpenses.find(e => e.id === selectedExpenseId);

  // Prepare confirmation details
  const confirmationDetails = selectedStaff ? {
    paymentType,
    staffName: selectedStaff.full_name,
    employeeId: selectedStaff.employee_id,
    amount,
    paymentMode,
    referenceMonth: paymentType === 'salary' ? referenceMonth : undefined,
    description: notes || undefined,
    expenseCategory: selectedExpense ? EXPENSE_CATEGORY_LABELS[selectedExpense.category as ExpenseCategory] : undefined,
  } : null;

  // Validation states
  const hasApprovedExpenses = approvedExpenses.length > 0;
  const hasUnsettledMonths = unsettledMonths.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record Payment"
        description="Process salary, advance, or expense payments"
      >
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Payment Form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              Payment Details
            </CardTitle>
            <CardDescription>
              Select payment type and enter details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Payment Type Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Payment Type *</Label>
              <RadioGroup 
                value={paymentType} 
                onValueChange={(v) => setPaymentType(v as PaymentType)}
                className="grid grid-cols-1 md:grid-cols-3 gap-3"
              >
                {PAYMENT_TYPES.map((type) => {
                  const Icon = type.icon;
                  const isDisabled = type.value === 'expense' && selectedStaffId && !hasApprovedExpenses;
                  const isSelected = paymentType === type.value;
                  
                  return (
                    <Label
                      key={type.value}
                      className={`
                        relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 cursor-pointer transition-all
                        ${isSelected 
                          ? 'border-primary bg-primary/5 shadow-md' 
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                        }
                        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <RadioGroupItem 
                        value={type.value} 
                        className="sr-only" 
                        disabled={isDisabled}
                      />
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                        <Icon className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <span className={`font-medium text-sm ${isSelected ? 'text-primary' : ''}`}>
                        {type.label}
                      </span>
                      <span className="text-xs text-muted-foreground text-center">
                        {type.description}
                      </span>
                      {isSelected && (
                        <CheckCircle2 className="absolute top-2 right-2 h-4 w-4 text-primary" />
                      )}
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>

            <Separator />

            {/* Staff Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Select Staff *</Label>
                <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          {s.full_name}
                          <Badge variant="outline" className="text-xs">
                            {s.employee_id}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Payment Mode *</Label>
                <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as PaymentMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Expense Selection (only for expense type) */}
            {paymentType === 'expense' && selectedStaffId && (
              <div className="space-y-2">
                <Label>Select Expense to Reimburse *</Label>
                {!hasApprovedExpenses ? (
                  <Alert className="border-warning bg-warning/10">
                    <Clock className="h-4 w-4 text-warning" />
                    <AlertDescription className="text-warning">
                      No approved expenses pending reimbursement for this staff member.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={selectedExpenseId} onValueChange={setSelectedExpenseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an approved expense" />
                    </SelectTrigger>
                    <SelectContent>
                      {approvedExpenses.map((expense) => (
                        <SelectItem key={expense.id} value={expense.id}>
                          <span className="flex items-center gap-2">
                            {EXPENSE_CATEGORY_LABELS[expense.category as ExpenseCategory]}
                            <span className="text-muted-foreground">-</span>
                            <Amount value={expense.amount} size="sm" />
                            <Badge variant="outline" className="text-xs">
                              {format(new Date(expense.expense_date), 'dd MMM')}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Salary Month Selection (only for salary type) */}
            {paymentType === 'salary' && selectedStaffId && (
              <div className="space-y-2">
                <Label>Settlement Month *</Label>
                {isLoadingMonths ? (
                  <div className="h-10 bg-muted animate-pulse rounded-lg" />
                ) : !hasUnsettledMonths ? (
                  <Alert className="border-info bg-info/10">
                    <AlertCircle className="h-4 w-4 text-info" />
                    <AlertDescription className="text-info">
                      All months are settled. Use the <strong>Salary Settlement</strong> page to process new settlements with leave deductions.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Select value={referenceMonth} onValueChange={setReferenceMonth}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      {unsettledMonths.map((month) => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <Label>Amount *</Label>
              <AmountInput
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
                disabled={paymentType === 'expense' && !!selectedExpenseId}
              />
              {paymentType === 'expense' && selectedExpenseId && (
                <p className="text-xs text-muted-foreground">
                  Amount auto-filled from selected expense
                </p>
              )}
            </div>

            {/* Reference Month (only for advance) */}
            {paymentType === 'advance' && (
              <div className="space-y-2">
                <Label>Reference Month (optional)</Label>
                <Select value={referenceMonth} onValueChange={setReferenceMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((month) => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  For tracking which month this advance relates to
                </p>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this payment..."
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Payment Info */}
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm border">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Payment will be recorded as:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Date: {format(new Date(), 'dd MMM yyyy')}</li>
                  <li>Paid by: {user?.email}</li>
                  <li>Entry type: {paymentType === 'advance' ? 'Debit (Staff owes)' : 'Credit (Paid to staff)'}</li>
                </ul>
              </div>
            </div>

            {/* Submit Button */}
            <Button 
              className="w-full" 
              size="lg"
              onClick={handleSubmitClick}
              disabled={
                isSubmitting || 
                !selectedStaffId || 
                amount <= 0 ||
                (paymentType === 'expense' && !selectedExpenseId) ||
                (paymentType === 'salary' && !hasUnsettledMonths)
              }
            >
              {isSubmitting ? 'Recording...' : 'Record Payment'}
            </Button>
          </CardContent>
        </Card>

        {/* Staff Financial Summary */}
        <StaffFinancialSummary
          staff={selectedStaff || null}
          financials={financials}
          approvedExpenses={approvedExpenses}
          isLoading={isLoadingFinancials}
        />
      </div>

      {/* Confirmation Dialog */}
      <PaymentConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handleConfirmPayment}
        details={confirmationDetails}
        isLoading={isSubmitting}
      />
    </div>
  );
}
