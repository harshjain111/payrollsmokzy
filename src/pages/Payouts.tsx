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
import type { PaymentMode, VoucherType, Expense, PaymentRequest, StaffPublic, SalarySettlement } from '@/types/database';
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

interface ApprovedRequest extends PaymentRequest {
  staff: StaffPublic;
}

interface PendingSalary extends SalarySettlement {
  staff: StaffPublic;
}

type PayoutItem = {
  id: string;
  type: 'expense' | 'request' | 'salary';
  staffName: string;
  staffId: string;
  employeeId: string;
  staffUserId?: string | null;
  amount: number;
  description: string;
  category?: string;
  date: string;
  referenceMonth?: string;
};

export default function Payouts() {
  const { user, isOwner, isAdmin, isAccountant, isStaff, canRecordSalaryPayments } = useAuth();
  
  // Access check - Staff cannot execute payouts
  const canExecutePayout = isOwner || isAdmin || isAccountant;
  
  const [activeTab, setActiveTab] = useState<'all' | 'expenses' | 'requests' | 'salary'>('all');
  const [approvedExpenses, setApprovedExpenses] = useState<ApprovedExpense[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequest[]>([]);
  const [pendingSalaries, setPendingSalaries] = useState<PendingSalary[]>([]);
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

      // Fetch approved requests (not yet paid - we'll track via ledger)
      const { data: requestsData, error: requestsError } = await supabase
        .from('payment_requests')
        .select(`
          *,
          staff:staff_id(*)
        `)
        .eq('status', 'approved')
        .order('approved_at', { ascending: true });

      if (requestsError) throw requestsError;
      setApprovedRequests((requestsData || []) as unknown as ApprovedRequest[]);

      // Fetch pending salary settlements (Owner only)
      if (canRecordSalaryPayments) {
        const { data: salaryData, error: salaryError } = await supabase
          .from('salary_settlements')
          .select(`
            *,
            staff:staff_id(*)
          `)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });

        if (salaryError) throw salaryError;
        setPendingSalaries((salaryData || []) as unknown as PendingSalary[]);
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
      } else if (selectedItem.type === 'request') {
        voucherType = 'advance';
        tag = 'advance';
        debit = selectedItem.amount; // Advance is debit (staff owes)
      } else {
        // salary
        voucherType = 'settlement';
        tag = 'salary';
        credit = selectedItem.amount; // Salary payment is credit
      }

      // Generate voucher number
      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: voucherType });

      if (voucherError) throw voucherError;

      // Create ledger entry
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
      } else if (selectedItem.type === 'request') {
        // Mark request as paid by updating status to a custom field or we delete it
        // For now, we'll delete the request since it's been paid
        const { error: deleteError } = await supabase
          .from('payment_requests')
          .delete()
          .eq('id', selectedItem.id);

        if (deleteError) throw deleteError;
      } else if (selectedItem.type === 'salary') {
        const { error: updateError } = await supabase
          .from('salary_settlements')
          .update({
            status: 'settled',
            settled_at: new Date().toISOString(),
            settled_by: user.id,
            ledger_entry_id: ledgerEntry.id,
          })
          .eq('id', selectedItem.id);

        if (updateError) throw updateError;
      }

      // Notify the staff member
      if (selectedItem.staffUserId) {
        const typeLabel = selectedItem.type === 'expense' 
          ? 'Expense Reimbursed' 
          : selectedItem.type === 'request' 
            ? 'Advance Paid' 
            : 'Salary Paid';
        
        const message = selectedItem.type === 'expense'
          ? `Your expense of ₹${selectedItem.amount.toLocaleString('en-IN')} has been reimbursed.`
          : selectedItem.type === 'request'
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

    // Add requests
    if (activeTab === 'all' || activeTab === 'requests') {
      approvedRequests.forEach(request => {
        items.push({
          id: request.id,
          type: 'request',
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

    // Add salary settlements (Owner only)
    if ((activeTab === 'all' || activeTab === 'salary') && canRecordSalaryPayments) {
      pendingSalaries.forEach(salary => {
        items.push({
          id: salary.id,
          type: 'salary',
          staffName: salary.staff?.full_name || 'Unknown',
          staffId: salary.staff_id,
          employeeId: salary.staff?.employee_id || '',
          staffUserId: salary.staff?.user_id,
          amount: salary.balance_payable,
          description: `Salary for ${format(new Date(salary.settlement_month + '-01'), 'MMMM yyyy')}`,
          date: salary.created_at,
          referenceMonth: salary.settlement_month,
        });
      });
    }

    return items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const payoutItems = getPayoutItems();
  const totalPending = approvedExpenses.length + approvedRequests.length + (canRecordSalaryPayments ? pendingSalaries.length : 0);

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
      case 'request': return Banknote;
      case 'salary': return Wallet;
    }
  };

  const getTypeBadgeVariant = (type: PayoutItem['type']) => {
    switch (type) {
      case 'expense': return 'outline';
      case 'request': return 'secondary';
      case 'salary': return 'default';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        description="Execute approved payments only. No manual entry allowed."
      />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Approved Expenses</p>
                <p className="text-2xl font-bold">{approvedExpenses.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-accent/50">
                <Banknote className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Approved Advances</p>
                <p className="text-2xl font-bold">{approvedRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {canRecordSalaryPayments && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-secondary">
                  <Wallet className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Salaries</p>
                  <p className="text-2xl font-bold">{pendingSalaries.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="all">
            All ({totalPending})
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses ({approvedExpenses.length})
          </TabsTrigger>
          <TabsTrigger value="requests">
            Advances ({approvedRequests.length})
          </TabsTrigger>
          {canRecordSalaryPayments && (
            <TabsTrigger value="salary">
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
                                {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
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
                              Approved: {format(new Date(item.date), 'dd MMM yyyy')}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <Amount value={item.amount} size="lg" className="text-foreground" />
                          <Button onClick={() => openPayoutDialog(item)} className="gap-2">
                            <CreditCard className="h-4 w-4" />
                            Pay Now
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
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Execute Payout
              {selectedItem && (
                <Badge variant={getTypeBadgeVariant(selectedItem.type)}>
                  {selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1)}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Confirm payment details before executing.
            </DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Staff</span>
                  <span className="font-medium">
                    {selectedItem.staffName} ({selectedItem.employeeId})
                  </span>
                </div>
                
                <Separator />
                
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Amount</span>
                  <Amount value={selectedItem.amount} size="lg" />
                </div>
                
                <Separator />
                
                <div>
                  <span className="text-muted-foreground text-sm">Description</span>
                  <p className="text-sm mt-1">{selectedItem.description}</p>
                </div>

                {selectedItem.referenceMonth && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Reference Month</span>
                      <span>{format(new Date(selectedItem.referenceMonth + '-01'), 'MMMM yyyy')}</span>
                    </div>
                  </>
                )}
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

              <p className="text-xs text-muted-foreground">
                This action will create a ledger entry and cannot be undone.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedItem(null)}
              disabled={isProcessing}
            >
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
                  Confirm Payout
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
