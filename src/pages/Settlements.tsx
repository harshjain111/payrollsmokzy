import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Amount } from '@/components/ui/amount';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Calculator, Check, AlertTriangle, Lock, Info, ShieldX } from 'lucide-react';
import { format, subMonths, getDaysInMonth, parseISO } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { SettlementConfirmDialog } from '@/components/settlements/SettlementConfirmDialog';
import { ZeroPaymentConfirmDialog } from '@/components/settlements/ZeroPaymentConfirmDialog';
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

interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: boolean;
}

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
];

export default function Settlements() {
  const navigate = useNavigate();
  const { user, canAccessSettlements } = useAuth();
  
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(subMonths(new Date(), 1), 'yyyy-MM'));
  const [leaveDays, setLeaveDays] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank_transfer');
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [calculation, setCalculation] = useState<SettlementCalculation | null>(null);
  const [isAlreadySettled, setIsAlreadySettled] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showZeroPaymentDialog, setShowZeroPaymentDialog] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (canAccessSettlements) {
      fetchStaff();
    }
  }, [canAccessSettlements]);

  useEffect(() => {
    if (canAccessSettlements && selectedStaffId && selectedMonth) {
      validateSettlement();
      calculateSettlement();
    }
  }, [selectedStaffId, selectedMonth, leaveDays, canAccessSettlements]);

  // STRICT ACCESS CONTROL: Only Owner can access settlements
  if (!canAccessSettlements) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <ShieldX className="h-16 w-16 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Salary settlements contain confidential compensation data and are restricted to the Owner only.
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

  const validateSettlement = async () => {
    try {
      const { data: settledData } = await supabase
        .rpc('is_salary_settled', {
          _staff_id: selectedStaffId,
          _month: selectedMonth,
        });
      
      setIsAlreadySettled(settledData);

      const { data: validationData, error } = await supabase
        .rpc('validate_settlement', {
          _staff_id: selectedStaffId,
          _month: selectedMonth,
        });

      if (error) throw error;
      
      const result = validationData as unknown as ValidationResult;
      setValidation(result);

      const newWarnings: string[] = [];
      
      if (result.warning) {
        newWarnings.push('Staff is inactive');
      }

      setWarnings(newWarnings);
    } catch (error) {
      console.error('Error validating settlement:', error);
    }
  };

  const calculateSettlement = async () => {
    if (!selectedStaffId || !selectedMonth) return;

    try {
      setIsCalculating(true);

      const { data: salaryData, error: salaryError } = await supabase
        .rpc('get_staff_salary_for_month', {
          _staff_id: selectedStaffId,
          _month: selectedMonth,
        });

      if (salaryError) throw salaryError;

      const { data: advanceData, error: advanceError } = await supabase
        .rpc('get_advances_outstanding', {
          _staff_id: selectedStaffId,
        });

      if (advanceError) throw advanceError;

      const monthlySalary = Number(salaryData) || 0;
      const daysInMonth = getDaysInMonth(parseISO(selectedMonth + '-01'));
      const dailySalary = monthlySalary / 30;
      const leaveDeduction = dailySalary * leaveDays;
      const grossSalary = monthlySalary - leaveDeduction;
      const advancesOutstanding = Number(advanceData) || 0;
      
      let netPayable = grossSalary - advancesOutstanding;
      let excessAdvance = 0;
      
      if (netPayable < 0) {
        excessAdvance = Math.abs(netPayable);
        netPayable = 0;
      }

      const newWarnings = [...warnings.filter(w => !w.includes('leave'))];
      if (leaveDays > 5) {
        newWarnings.push(`High leave days (${leaveDays} days) - please verify`);
      }
      if (leaveDays > daysInMonth) {
        newWarnings.push(`Leave days exceed days in month (${daysInMonth})`);
      }
      setWarnings(newWarnings);

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

  const handleSettleClick = () => {
    if (!calculation) return;

    const daysInMonth = getDaysInMonth(parseISO(selectedMonth + '-01'));
    
    if (leaveDays > 30) {
      toast({
        title: 'Invalid Leave Days',
        description: 'Leave days cannot exceed 30.',
        variant: 'destructive',
      });
      return;
    }

    if (leaveDays > daysInMonth) {
      toast({
        title: 'Invalid Leave Days',
        description: `Leave days cannot exceed ${daysInMonth} for this month.`,
        variant: 'destructive',
      });
      return;
    }

    if (calculation.netPayable === 0) {
      setShowZeroPaymentDialog(true);
    } else {
      setShowConfirmDialog(true);
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

      const { data: voucherNo, error: voucherError } = await supabase
        .rpc('generate_voucher_no', { _voucher_type: 'settlement' });

      if (voucherError) throw voucherError;

      let ledgerEntryId = null;
      if (calculation.netPayable > 0) {
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
        ledgerEntryId = ledgerEntry.id;
      }

      if (calculation.advancesOutstanding > 0 && calculation.grossSalary > 0) {
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
          ledger_entry_id: ledgerEntryId,
          created_by: user?.id,
        });

      if (settlementError) throw settlementError;

      toast({
        title: 'Salary Settled',
        description: `Salary for ${format(new Date(selectedMonth + '-01'), 'MMMM yyyy')} has been settled successfully.`,
      });

      setSelectedStaffId('');
      setLeaveDays(0);
      setCalculation(null);
      setIsAlreadySettled(false);
      setShowConfirmDialog(false);
      setShowZeroPaymentDialog(false);
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

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  }).filter(m => m.value <= format(new Date(), 'yyyy-MM'));

  const selectedStaff = staff.find(s => s.id === selectedStaffId);
  const daysInMonth = selectedMonth ? getDaysInMonth(parseISO(selectedMonth + '-01')) : 30;
  const canSettle = calculation && !isAlreadySettled && validation?.valid !== false && leaveDays <= 30;

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
              <Alert className="border-warning bg-warning/10">
                <Lock className="h-4 w-4 text-warning" />
                <AlertDescription className="text-warning">
                  Salary for this month is already settled and cannot be modified.
                </AlertDescription>
              </Alert>
            )}

            {validation && !validation.valid && !isAlreadySettled && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{validation.error}</AlertDescription>
              </Alert>
            )}

            {warnings.length > 0 && validation?.valid && (
              <Alert className="border-warning bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription className="text-warning">
                  {warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="leaveDays">
                Leave Days to Deduct
                <Badge variant="outline" className="ml-2">{daysInMonth} days in month</Badge>
              </Label>
              <Input
                id="leaveDays"
                type="number"
                min="0"
                max="30"
                value={leaveDays}
                onChange={(e) => {
                  const value = Number(e.target.value) || 0;
                  setLeaveDays(Math.min(30, Math.max(0, value)));
                }}
                placeholder="0"
                disabled={isAlreadySettled}
              />
              <p className="text-xs text-muted-foreground">
                Unpaid leave days (max 30). Daily rate = Salary / 30
              </p>
            </div>

            <div className="space-y-2">
              <Label>Payment Mode *</Label>
              <Select 
                value={paymentMode} 
                onValueChange={(v) => setPaymentMode(v as PaymentMode)}
                disabled={isAlreadySettled}
              >
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
              {selectedStaff ? `For ${selectedStaff.full_name}` : 'Select a staff member'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!calculation ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Calculator className="h-12 w-12 mb-4 opacity-50" />
                <p>Select staff and month to calculate</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Monthly Salary</span>
                  <Amount value={calculation.monthlySalary} className="font-medium" />
                </div>
                
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">
                    Leave Deduction ({calculation.leaveDays} days × ₹{calculation.dailySalary.toFixed(2)})
                  </span>
                  <span className="text-destructive font-medium">
                    -<Amount value={calculation.leaveDeduction} />
                  </span>
                </div>
                
                <Separator />
                
                <div className="flex justify-between items-center py-2">
                  <span className="font-medium">Gross Salary</span>
                  <Amount value={calculation.grossSalary} className="font-medium" />
                </div>
                
                {calculation.advancesOutstanding > 0 && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-muted-foreground">Advances Outstanding</span>
                    <span className="text-warning font-medium">
                      -<Amount value={Math.min(calculation.advancesOutstanding, calculation.grossSalary)} />
                    </span>
                  </div>
                )}
                
                <Separator />
                
                <div className="flex justify-between items-center py-3 bg-primary/5 rounded-lg px-4 -mx-4">
                  <span className="font-semibold text-lg">Net Payable</span>
                  <Amount value={calculation.netPayable} size="lg" className="font-bold text-primary" />
                </div>
                
                {calculation.excessAdvance > 0 && (
                  <Alert className="border-info bg-info/10">
                    <Info className="h-4 w-4 text-info" />
                    <AlertDescription className="text-info">
                      ₹{calculation.excessAdvance.toLocaleString('en-IN')} advance will remain outstanding after this settlement.
                    </AlertDescription>
                  </Alert>
                )}
                
                <Button 
                  onClick={handleSettleClick}
                  disabled={!canSettle || isSettling}
                  className="w-full mt-4"
                  size="lg"
                >
                  {isSettling ? (
                    'Processing...'
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Settle Salary
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialogs */}
      {calculation && selectedStaff && (
        <>
          <SettlementConfirmDialog
            open={showConfirmDialog}
            onOpenChange={setShowConfirmDialog}
            onConfirm={handleSettle}
            isLoading={isSettling}
            staffName={selectedStaff.full_name}
            month={format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
            calculation={calculation}
            paymentMode={paymentMode}
          />
          
          <ZeroPaymentConfirmDialog
            open={showZeroPaymentDialog}
            onOpenChange={setShowZeroPaymentDialog}
            onConfirm={handleSettle}
            isLoading={isSettling}
            staffName={selectedStaff.full_name}
            month={format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
            reason={`Advances (₹${calculation.advancesOutstanding.toLocaleString('en-IN')}) exceed or equal gross salary`}
          />
        </>
      )}
    </div>
  );
}