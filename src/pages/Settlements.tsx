import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Amount, AmountInput } from '@/components/ui/amount';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Calculator, Check, AlertTriangle } from 'lucide-react';
import { format, subMonths } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { Staff, PaymentMode } from '@/types/database';

interface SettlementCalculation {
  monthlySalary: number;
  dailySalary: number;
  leaveDays: number;
  leaveDeduction: number;
  grossSalary: number;
  advancesOutstanding: number;
  netPayable: number;
  excessAdvance: number;
}

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export default function Settlements() {
  const navigate = useNavigate();
  const { user, isOwner } = useAuth();
  
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(subMonths(new Date(), 1), 'yyyy-MM'));
  const [leaveDays, setLeaveDays] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [calculation, setCalculation] = useState<SettlementCalculation | null>(null);
  const [isAlreadySettled, setIsAlreadySettled] = useState(false);

  useEffect(() => {
    if (!isOwner) {
      toast({
        title: 'Access Denied',
        description: 'Only owners can settle salaries.',
        variant: 'destructive',
      });
      navigate('/dashboard');
      return;
    }
    fetchStaff();
  }, [isOwner]);

  useEffect(() => {
    if (selectedStaffId && selectedMonth) {
      checkSettlementStatus();
      calculateSettlement();
    }
  }, [selectedStaffId, selectedMonth, leaveDays]);

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

  const checkSettlementStatus = async () => {
    try {
      const { data, error } = await supabase
        .rpc('is_salary_settled', {
          _staff_id: selectedStaffId,
          _month: selectedMonth,
        });

      if (error) throw error;
      setIsAlreadySettled(data);
    } catch (error) {
      console.error('Error checking settlement status:', error);
    }
  };

  const calculateSettlement = async () => {
    if (!selectedStaffId || !selectedMonth) return;

    try {
      setIsCalculating(true);

      // Get salary for the month
      const { data: salaryData, error: salaryError } = await supabase
        .rpc('get_staff_salary_for_month', {
          _staff_id: selectedStaffId,
          _month: selectedMonth,
        });

      if (salaryError) throw salaryError;

      // Get advances outstanding
      const { data: advanceData, error: advanceError } = await supabase
        .rpc('get_advances_outstanding', {
          _staff_id: selectedStaffId,
        });

      if (advanceError) throw advanceError;

      const monthlySalary = Number(salaryData) || 0;
      const dailySalary = monthlySalary / 30;
      const leaveDeduction = dailySalary * leaveDays;
      const grossSalary = monthlySalary - leaveDeduction;
      const advancesOutstanding = Number(advanceData) || 0;
      
      // Calculate net payable
      let netPayable = grossSalary - advancesOutstanding;
      let excessAdvance = 0;
      
      if (netPayable < 0) {
        excessAdvance = Math.abs(netPayable);
        netPayable = 0;
      }

      setCalculation({
        monthlySalary,
        dailySalary,
        leaveDays,
        leaveDeduction,
        grossSalary,
        advancesOutstanding,
        netPayable,
        excessAdvance,
      });
    } catch (error) {
      console.error('Error calculating settlement:', error);
      toast({
        title: 'Calculation Error',
        description: 'Failed to calculate settlement. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCalculating(false);
    }
  };

  const handleSettle = async () => {
    if (!calculation || !selectedStaffId || !selectedMonth) return;

    if (isAlreadySettled) {
      toast({
        title: 'Already Settled',
        description: 'Salary for this month has already been settled.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSettling(true);

      // Generate voucher number
      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: 'settlement' });

      if (voucherError) throw voucherError;

      // Create ledger entry for salary payment
      const { data: ledgerEntry, error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          staff_id: selectedStaffId,
          voucher_type: 'settlement',
          voucher_no: voucherNo,
          entry_date: new Date().toISOString().split('T')[0],
          description: `Salary settlement for ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}`,
          debit: 0,
          credit: calculation.netPayable,
          tag: 'salary',
          reference_month: selectedMonth,
          payment_mode: paymentMode,
          paid_by: user?.id,
          approved_by: user?.id,
          is_immutable: true,
          created_by: user?.id,
        })
        .select()
        .single();

      if (ledgerError) throw ledgerError;

      // If there were advances, create adjustment entry
      if (calculation.advancesOutstanding > 0) {
        const adjustmentAmount = Math.min(calculation.advancesOutstanding, calculation.grossSalary);
        
        const { data: adjustVoucher } = await supabase
          .rpc('generate_voucher_no', { _voucher_type: 'journal' });

        await supabase
          .from('ledger_entries')
          .insert({
            staff_id: selectedStaffId,
            voucher_type: 'journal',
            voucher_no: adjustVoucher,
            entry_date: new Date().toISOString().split('T')[0],
            description: `Advance adjustment against ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')} salary`,
            debit: 0,
            credit: adjustmentAmount,
            tag: 'advance',
            reference_month: selectedMonth,
            is_immutable: true,
            created_by: user?.id,
          });
      }

      // Create salary settlement record
      const { error: settlementError } = await supabase
        .from('salary_settlements')
        .insert({
          staff_id: selectedStaffId,
          settlement_month: selectedMonth,
          base_salary: calculation.monthlySalary,
          leave_days: calculation.leaveDays,
          leave_deduction: calculation.leaveDeduction,
          net_salary: calculation.grossSalary,
          advances_adjusted: Math.min(calculation.advancesOutstanding, calculation.grossSalary),
          balance_payable: calculation.netPayable,
          status: 'settled',
          settled_at: new Date().toISOString(),
          settled_by: user?.id,
          ledger_entry_id: ledgerEntry.id,
          created_by: user?.id,
        });

      if (settlementError) throw settlementError;

      toast({
        title: 'Salary Settled',
        description: `Salary for ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')} has been settled successfully.`,
      });

      // Reset form
      setSelectedStaffId('');
      setLeaveDays(0);
      setCalculation(null);
      setIsAlreadySettled(false);
    } catch (error: any) {
      console.error('Error settling salary:', error);
      toast({
        title: 'Settlement Failed',
        description: error.message || 'Failed to settle salary. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSettling(false);
    }
  };

  // Generate month options (last 12 months)
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
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
        title="Salary Settlement"
        description="Process monthly salary settlements"
      >
        <Button variant="ghost" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Selection Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Settlement Details</CardTitle>
            <CardDescription>Select staff and month to settle</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Select Staff *</Label>
              <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a staff member" />
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
              <Label>Settlement Month *</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Select month" />
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

            {isAlreadySettled && (
              <div className="flex items-center gap-2 p-3 bg-warning/10 text-warning rounded-lg">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  Salary for this month is already settled
                </span>
              </div>
            )}

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="leaveDays">Leave Days to Deduct</Label>
              <Input
                id="leaveDays"
                type="number"
                min="0"
                max="30"
                value={leaveDays}
                onChange={(e) => setLeaveDays(Number(e.target.value) || 0)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Unpaid leave days (max 30)
              </p>
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
          </CardContent>
        </Card>

        {/* Calculation Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Settlement Calculation
            </CardTitle>
            <CardDescription>
              {selectedStaff ? selectedStaff.full_name : 'Select a staff member'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isCalculating ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : calculation ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Monthly Salary</p>
                    <Amount value={calculation.monthlySalary} className="text-foreground" />
                  </div>
                  <div>
                    <p className="text-muted-foreground">Daily Rate</p>
                    <Amount value={calculation.dailySalary} className="text-foreground" />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Monthly Salary</span>
                    <Amount value={calculation.monthlySalary} />
                  </div>
                  {calculation.leaveDays > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span>Leave Deduction ({calculation.leaveDays} days)</span>
                      <span>- <Amount value={calculation.leaveDeduction} /></span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium">
                    <span>Gross Salary</span>
                    <Amount value={calculation.grossSalary} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  {calculation.advancesOutstanding > 0 && (
                    <div className="flex justify-between text-warning">
                      <span>Advances Outstanding</span>
                      <span>- <Amount value={calculation.advancesOutstanding} /></span>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="p-4 bg-primary/5 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Net Payable</span>
                    <Amount value={calculation.netPayable} size="lg" className="text-primary font-bold" />
                  </div>
                  {calculation.excessAdvance > 0 && (
                    <p className="text-xs text-warning mt-2">
                      ₹{calculation.excessAdvance.toLocaleString('en-IN')} excess advance will carry forward
                    </p>
                  )}
                </div>

                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleSettle}
                  disabled={isSettling || isAlreadySettled || calculation.netPayable <= 0}
                >
                  <Check className="mr-2 h-4 w-4" />
                  {isSettling ? 'Processing...' : 'Confirm & Settle'}
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Select staff and month to see calculation
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
