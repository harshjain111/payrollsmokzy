import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AmountInput, Amount } from '@/components/ui/amount';
import { ArrowLeft, CreditCard, AlertCircle } from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { Staff, PaymentMode, VoucherType } from '@/types/database';

type PaymentType = 'salary' | 'advance';

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export default function RecordPayment() {
  const navigate = useNavigate();
  const { user, isOwner, isAccountant } = useAuth();
  
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [paymentType, setPaymentType] = useState<PaymentType>('advance');
  const [amount, setAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [referenceMonth, setReferenceMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Staff financial data
  const [staffBalance, setStaffBalance] = useState(0);
  const [advancesOutstanding, setAdvancesOutstanding] = useState(0);

  useEffect(() => {
    if (!isOwner && !isAccountant) {
      toast({
        title: 'Access Denied',
        description: 'Only owners and accountants can record payments.',
        variant: 'destructive',
      });
      navigate('/dashboard');
      return;
    }
    fetchStaff();
  }, [isOwner, isAccountant]);

  useEffect(() => {
    if (selectedStaffId) {
      fetchStaffFinancials();
    }
  }, [selectedStaffId]);

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
      // Get advances outstanding
      const { data: advanceData, error: advanceError } = await supabase
        .rpc('get_advances_outstanding', {
          _staff_id: selectedStaffId,
        });

      if (advanceError) throw advanceError;
      setAdvancesOutstanding(Number(advanceData) || 0);

      // Calculate current balance from ledger
      const { data: ledgerData, error: ledgerError } = await supabase
        .from('ledger_entries')
        .select('debit, credit')
        .eq('staff_id', selectedStaffId);

      if (ledgerError) throw ledgerError;

      const balance = ledgerData?.reduce((sum, entry) => {
        return sum + Number(entry.debit || 0) - Number(entry.credit || 0);
      }, 0) || 0;

      setStaffBalance(balance);
    } catch (error) {
      console.error('Error fetching staff financials:', error);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!selectedStaffId) {
      toast({ title: 'Validation Error', description: 'Please select a staff member.', variant: 'destructive' });
      return;
    }
    if (amount <= 0) {
      toast({ title: 'Validation Error', description: 'Amount must be greater than 0.', variant: 'destructive' });
      return;
    }

    try {
      setIsSubmitting(true);

      // Determine voucher type based on payment type
      const voucherType: VoucherType = paymentType === 'salary' ? 'payment' : 'advance';

      // Generate voucher number
      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: voucherType });

      if (voucherError) throw voucherError;

      // Create ledger entry
      const { error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          staff_id: selectedStaffId,
          voucher_type: voucherType,
          voucher_no: voucherNo,
          entry_date: new Date().toISOString().split('T')[0],
          description: notes.trim() || `${paymentType === 'salary' ? 'Salary' : 'Advance'} payment`,
          debit: paymentType === 'advance' ? amount : 0,
          credit: paymentType === 'salary' ? amount : 0,
          tag: paymentType === 'salary' ? 'salary' : 'advance',
          reference_month: referenceMonth,
          payment_mode: paymentMode,
          paid_by: user?.id,
          is_immutable: false,
          created_by: user?.id,
        });

      if (ledgerError) throw ledgerError;

      const staffMember = staff.find(s => s.id === selectedStaffId);
      toast({
        title: 'Payment Recorded',
        description: `₹${amount.toLocaleString('en-IN')} ${paymentType} payment recorded for ${staffMember?.full_name}.`,
      });

      // Reset form
      setSelectedStaffId('');
      setAmount(0);
      setNotes('');
      setPaymentType('advance');
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

  // Generate month options
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  });

  const selectedStaff = staff.find(s => s.id === selectedStaffId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Record Payment"
        description="Record salary or advance payment"
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
              <CreditCard className="h-5 w-5" />
              Payment Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                        {s.full_name} ({s.employee_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Payment Type *</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="advance">Advance</SelectItem>
                    <SelectItem value="salary">Salary Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Amount *</Label>
              <AmountInput
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="space-y-2">
                <Label>Reference Month</Label>
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
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this payment..."
                rows={2}
              />
            </div>

            <Button 
              className="w-full" 
              size="lg"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Recording...' : 'Record Payment'}
            </Button>
          </CardContent>
        </Card>

        {/* Staff Financial Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Staff Summary</CardTitle>
            <CardDescription>
              {selectedStaff ? selectedStaff.full_name : 'Select a staff member'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedStaffId ? (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-secondary/50">
                  <p className="text-xs text-muted-foreground">Monthly Salary</p>
                  <Amount 
                    value={selectedStaff?.monthly_salary || 0} 
                    size="lg" 
                    className="text-foreground"
                  />
                </div>

                <div className="p-3 rounded-lg bg-warning/10">
                  <p className="text-xs text-muted-foreground">Advances Outstanding</p>
                  <Amount 
                    value={advancesOutstanding} 
                    size="lg" 
                    className={advancesOutstanding > 0 ? 'text-warning' : 'text-foreground'}
                  />
                </div>

                <div className="p-3 rounded-lg bg-primary/5">
                  <p className="text-xs text-muted-foreground">Current Balance</p>
                  <Amount 
                    value={staffBalance} 
                    size="lg" 
                    showSign
                    className="text-foreground"
                  />
                </div>

                {advancesOutstanding > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-info/10 rounded-lg text-xs">
                    <AlertCircle className="h-4 w-4 text-info mt-0.5" />
                    <p className="text-info">
                      Advances will be adjusted during salary settlement
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Select a staff member to see their financial summary
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
