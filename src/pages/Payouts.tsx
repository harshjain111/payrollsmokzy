import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Amount } from '@/components/ui/amount';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  Receipt, 
  CreditCard, 
  Loader2,
  CheckCircle2,
  Banknote,
  ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { PaymentMode, VoucherType, Expense, PaymentRequest, StaffPublic } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS } from '@/types/database';

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

interface ApprovedExpense extends Expense {
  staff: StaffPublic;
}

interface ApprovedRequest extends Omit<PaymentRequest, 'payout_type' | 'settlement_id'> {
  staff: StaffPublic;
  payout_type?: string | null;
  settlement_id?: string | null;
}

type PayoutItem = {
  id: string;
  type: 'expense' | 'advance' | 'salary';
  staffName: string;
  staffId: string;
  employeeId: string;
  staffUserId?: string | null;
  amount: number;
  description: string;
  category?: string;
  date: string;
  referenceMonth?: string;
  settlementId?: string;
};

export default function Payouts() {
  const { user, isOwner, isAdmin, isAccountant, isStaff, canRecordSalaryPayments } = useAuth();
  
  // Access check - Staff cannot execute payouts
  const canExecutePayout = isOwner || isAdmin || isAccountant;
  
  const [activeTab, setActiveTab] = useState<'all' | 'expenses' | 'advances' | 'salary'>('all');
  const [approvedExpenses, setApprovedExpenses] = useState<ApprovedExpense[]>([]);
  const [approvedAdvances, setApprovedAdvances] = useState<ApprovedRequest[]>([]);
  const [pendingSalaries, setPendingSalaries] = useState<ApprovedRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Payout dialog state
  const [selectedItem, setSelectedItem] = useState<PayoutItem | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (canExecutePayout) {
      fetchApprovedItems();
    } else {
      setIsLoading(false);
    }
  }, [canExecutePayout]);

  const fetchApprovedItems = async () => {
    setIsLoading(true);
    try {
      // Fetch approved expenses (not yet reimbursed)
      const { data: expensesData, error: expensesError } = await supabase
        .from('expenses')
        .select(`
          *,
          staff:staff_id(*)
        `)
        .eq('status', 'approved')
        .order('approved_at', { ascending: true });

      if (expensesError) throw expensesError;
      setApprovedExpenses((expensesData || []) as unknown as ApprovedExpense[]);

      // Fetch approved ADVANCE requests (payout_type = 'advance' or null, not yet paid)
      const { data: advanceData, error: advanceError } = await supabase
        .from('payment_requests')
        .select(`
          *,
          staff:staff_id(*)
        `)
        .eq('status', 'approved')
        .is('paid_at', null)
        .or('payout_type.is.null,payout_type.eq.advance')
        .order('approved_at', { ascending: true });

      if (advanceError) throw advanceError;
      setApprovedAdvances((advanceData || []) as unknown as ApprovedRequest[]);

      // Fetch pending SALARY payout requests (Owner only, payout_type = 'salary')
      if (canRecordSalaryPayments) {
        const { data: salaryData, error: salaryError } = await supabase
          .from('payment_requests')
          .select(`
            *,
            staff:staff_id(*)
          `)
          .eq('status', 'approved')
          .eq('payout_type', 'salary')
          .is('paid_at', null)
          .order('approved_at', { ascending: true });

        if (salaryError) throw salaryError;
        setPendingSalaries((salaryData || []) as unknown as ApprovedRequest[]);
      }
    } catch (error) {
      console.error('Error fetching approved items:', error);
      toast({
        title: 'Error',
        description: 'Failed to load approved items',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecutePayout = async () => {
    if (!selectedItem || !user) return;

    setIsProcessing(true);
    try {
      let voucherType: VoucherType;
      let tag: string;
      let debit = 0;
      let credit = 0;

      if (selectedItem.type === 'expense') {
        voucherType = 'expense';
        tag = 'expense';
        credit = selectedItem.amount; // Reimbursement is credit
      } else if (selectedItem.type === 'advance') {
        voucherType = 'advance';
        tag = 'advance';
        debit = selectedItem.amount; // Advance is debit (staff owes)
      } else {
        // salary payout
        voucherType = 'settlement';
        tag = 'salary';
        credit = selectedItem.amount; // Salary payment is credit
      }

      // Generate voucher number
      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: voucherType });

      if (voucherError) throw voucherError;

      // Create ledger entry (THIS is where ledger entry is created for salary!)
      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          staff_id: selectedItem.staffId,
          voucher_type: voucherType,
          voucher_no: voucherNo,
          entry_date: new Date().toISOString().split('T')[0],
          description: selectedItem.description,
          debit,
          credit,
          tag,
          reference_month: selectedItem.referenceMonth || null,
          payment_mode: paymentMode,
          paid_by: user.id,
          is_immutable: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (ledgerError) throw ledgerError;

      // Update the source record based on type
      if (selectedItem.type === 'expense') {
        const { error: updateError } = await supabase
          .from('expenses')
          .update({
            status: 'reimbursed',
            reimbursed_at: new Date().toISOString(),
            reimbursed_by: user.id,
            ledger_entry_id: ledgerEntry.id,
          })
          .eq('id', selectedItem.id);

        if (updateError) throw updateError;
      } else if (selectedItem.type === 'advance' || selectedItem.type === 'salary') {
        // Mark request as paid
        const { error: updateError } = await supabase
          .from('payment_requests')
          .update({
            paid_at: new Date().toISOString(),
            paid_by: user.id,
            ledger_entry_id: ledgerEntry.id,
          })
          .eq('id', selectedItem.id);

        if (updateError) throw updateError;

        // For salary payouts, also update the settlement record
        if (selectedItem.type === 'salary' && selectedItem.settlementId) {
          const { error: settlementError } = await supabase
            .from('salary_settlements')
            .update({
              paid_at: new Date().toISOString(),
              paid_by: user.id,
              payment_mode: paymentMode,
              ledger_entry_id: ledgerEntry.id,
            })
            .eq('id', selectedItem.settlementId);

          if (settlementError) {
            console.error('Error updating settlement:', settlementError);
          }
        }
      }

      // Notify the staff member
      if (selectedItem.staffUserId) {
        const typeLabel = selectedItem.type === 'expense' 
          ? 'Expense Reimbursed' 
          : selectedItem.type === 'advance' 
            ? 'Advance Paid' 
            : 'Salary Paid';
        
        const message = selectedItem.type === 'expense'
          ? `Your expense of ₹${selectedItem.amount.toLocaleString('en-IN')} has been reimbursed.`
          : selectedItem.type === 'advance'
            ? `Your advance request of ₹${selectedItem.amount.toLocaleString('en-IN')} has been paid.`
            : `Your salary of ₹${selectedItem.amount.toLocaleString('en-IN')} has been paid.`;

        await supabase.rpc('create_notification', {
          _user_id: selectedItem.staffUserId,
          _title: typeLabel,
          _message: message,
          _type: 'success',
          _reference_type: 'ledger_entry',
          _reference_id: ledgerEntry.id,
        });
      }

      toast({
        title: 'Payout Successful',
        description: `₹${selectedItem.amount.toLocaleString('en-IN')} paid to ${selectedItem.staffName}.`,
      });

      setSelectedItem(null);
      setPaymentMode('bank_transfer');
      fetchApprovedItems();
    } catch (error: any) {
      console.error('Error executing payout:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to execute payout. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const openPayoutDialog = (item: PayoutItem) => {
    setSelectedItem(item);
    setPaymentMode('bank_transfer');
  };

  // Convert data to unified PayoutItem format
  const getPayoutItems = (): PayoutItem[] => {
    const items: PayoutItem[] = [];

    // Add expenses
    if (activeTab === 'all' || activeTab === 'expenses') {
      approvedExpenses.forEach(expense => {
        items.push({
          id: expense.id,
          type: 'expense',
          staffName: expense.staff?.full_name || 'Unknown',
          staffId: expense.staff_id,
          employeeId: expense.staff?.employee_id || '',
          staffUserId: expense.staff?.user_id,
          amount: expense.amount,
          description: `Expense: ${expense.description}`,
          category: EXPENSE_CATEGORY_LABELS[expense.category],
          date: expense.approved_at || expense.expense_date,
        });
      });
    }

    // Add advance requests
    if (activeTab === 'all' || activeTab === 'advances') {
      approvedAdvances.forEach(request => {
        items.push({
          id: request.id,
          type: 'advance',
          staffName: request.staff?.full_name || 'Unknown',
          staffId: request.staff_id,
          employeeId: request.staff?.employee_id || '',
          staffUserId: request.staff?.user_id,
          amount: request.amount,
          description: `Advance: ${request.reason}`,
          date: request.approved_at || request.created_at,
        });
      });
    }

    // Add salary payout requests (Owner only)
    if ((activeTab === 'all' || activeTab === 'salary') && canRecordSalaryPayments) {
      pendingSalaries.forEach(salary => {
        // Extract reference month from reason (format: "Salary for MMMM yyyy")
        const monthMatch = salary.reason.match(/Salary for (.+)/);
        const refMonth = monthMatch ? monthMatch[1] : '';
        
        items.push({
          id: salary.id,
          type: 'salary',
          staffName: salary.staff?.full_name || 'Unknown',
          staffId: salary.staff_id,
          employeeId: salary.staff?.employee_id || '',
          staffUserId: salary.staff?.user_id,
          amount: salary.amount,
          description: salary.reason,
          date: salary.approved_at || salary.created_at,
          settlementId: salary.settlement_id,
        });
      });
    }

    return items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const payoutItems = getPayoutItems();
  const totalPending = approvedExpenses.length + approvedAdvances.length + (canRecordSalaryPayments ? pendingSalaries.length : 0);

  // Access denied for staff
  if (isStaff || !canExecutePayout) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Wallet className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">
          Only authorized personnel can execute payouts.
        </p>
      </div>
    );
  }

  const getTypeIcon = (type: PayoutItem['type']) => {
    switch (type) {
      case 'expense': return Receipt;
      case 'advance': return Banknote;
      case 'salary': return Wallet;
    }
  };

  const getTypeBadgeVariant = (type: PayoutItem['type']) => {
    switch (type) {
      case 'expense': return 'outline';
      case 'advance': return 'secondary';
      case 'salary': return 'default';
    }
  };

  const getTypeLabel = (type: PayoutItem['type']) => {
    switch (type) {
      case 'expense': return 'Expense';
      case 'advance': return 'Advance';
      case 'salary': return 'Salary';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="Execute approved payments only. No manual entry allowed."
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <Card>
          <CardContent className="p-4 md:pt-6">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="p-2 md:p-3 rounded-lg bg-primary/10">
                <Receipt className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Expenses</p>
                <p className="text-xl md:text-2xl font-bold">{approvedExpenses.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 md:pt-6">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="p-2 md:p-3 rounded-lg bg-accent/50">
                <Banknote className="h-4 w-4 md:h-5 md:w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Advances</p>
                <p className="text-xl md:text-2xl font-bold">{approvedAdvances.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {canRecordSalaryPayments && (
          <Card className="col-span-2 md:col-span-1">
            <CardContent className="p-4 md:pt-6">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="p-2 md:p-3 rounded-lg bg-secondary">
                  <Wallet className="h-4 w-4 md:h-5 md:w-5 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground">Salaries</p>
                  <p className="text-xl md:text-2xl font-bold">{pendingSalaries.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="all" className="flex-shrink-0">
            All ({totalPending})
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex-shrink-0">
            Expenses ({approvedExpenses.length})
          </TabsTrigger>
          <TabsTrigger value="advances" className="flex-shrink-0">
            Advances ({approvedAdvances.length})
          </TabsTrigger>
          {canRecordSalaryPayments && (
            <TabsTrigger value="salary" className="flex-shrink-0">
              Salary ({pendingSalaries.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : payoutItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No pending payouts"
              description="All approved items have been paid. Check the Requests page to approve new items."
            />
          ) : (
            <div className="grid gap-4">
              {payoutItems.map((item) => {
                const TypeIcon = getTypeIcon(item.type);
                return (
                  <Card key={`${item.type}-${item.id}`} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="p-2 rounded-lg bg-muted">
                            <TypeIcon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={getTypeBadgeVariant(item.type)}>
                                {getTypeLabel(item.type)}
                              </Badge>
                              {item.category && (
                                <span className="text-xs text-muted-foreground">
                                  {item.category}
                                </span>
                              )}
                            </div>
                            <p className="font-medium">{item.staffName}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              {item.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Approved: {item.date ? format(new Date(item.date), 'dd MMM yyyy') : '-'}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <Amount value={item.amount} className="text-lg font-semibold" />
                          <Button 
                            onClick={() => openPayoutDialog(item)}
                            className="shrink-0"
                          >
                            <CreditCard className="mr-2 h-4 w-4" />
                            Pay
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Payout Confirmation Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Execute Payout</DialogTitle>
            <DialogDescription>
              Confirm payment details before executing
            </DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant={getTypeBadgeVariant(selectedItem.type)}>
                    {getTypeLabel(selectedItem.type)}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Staff</span>
                  <span className="font-medium">{selectedItem.staffName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Description</span>
                  <span className="text-right max-w-[200px] truncate">{selectedItem.description}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <Amount value={selectedItem.amount} className="text-lg font-bold text-primary" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment Mode</Label>
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

              <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                <p>
                  This action will create an immutable ledger entry and mark the {selectedItem.type} as paid.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleExecutePayout} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirm Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}