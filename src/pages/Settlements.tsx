import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { EnhancedSettlementConfirmDialog } from '@/components/settlements/EnhancedSettlementConfirmDialog';
import { ZeroPaymentConfirmDialog } from '@/components/settlements/ZeroPaymentConfirmDialog';
import { AdvanceAdjustmentInput } from '@/components/settlements/AdvanceAdjustmentInput';
import { LeaveDeductionSection } from '@/components/settlements/LeaveDeductionSection';
import { createSalarySettlementEntry } from '@/lib/journal-entries';
import type { Staff, PaymentMode } from '@/types/database';

interface SettlementCalculation {
  monthlySalary: number;
  dailySalary: number;
   systemDeductionDays: number;
   finalDeductionDays: number;
   deductionAdjustmentReason?: string;
  leaveDeduction: number;
  grossSalary: number;
  advancesOutstanding: number;
  advanceToAdjust: number;
  netPayable: number;
  carryForwardAdvance: number;
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
  const [searchParams] = useSearchParams();
  const { user, canAccessSettlements } = useAuth();
  
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(searchParams.get('staff') || '');
  const [selectedMonth, setSelectedMonth] = useState<string>(searchParams.get('month') || format(subMonths(new Date(), 1), 'yyyy-MM'));
  // Leave deduction state (from LeaveDeductionSection)
  const [systemDeductionDays, setSystemDeductionDays] = useState(0);
  const [finalDeductionDays, setFinalDeductionDays] = useState(0);
  const [deductionAdjustmentReason, setDeductionAdjustmentReason] = useState('');
  const [advanceToAdjust, setAdvanceToAdjust] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
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
    }
  }, [selectedStaffId, selectedMonth, canAccessSettlements]);

  // Recalculate when deduction days change
  useEffect(() => {
    if (canAccessSettlements && selectedStaffId && selectedMonth) {
      calculateSettlement();
    }
  }, [selectedStaffId, selectedMonth, finalDeductionDays, canAccessSettlements]);

  // Recalculate when advance adjustment changes
  useEffect(() => {
    if (calculation && calculation.advancesOutstanding > 0) {
      const maxAdjustable = Math.min(calculation.advancesOutstanding, calculation.grossSalary);
      const clampedAdjustment = Math.min(advanceToAdjust, maxAdjustable);
      const netPayable = calculation.grossSalary - clampedAdjustment;
      const carryForward = calculation.advancesOutstanding - clampedAdjustment;
      
      setCalculation(prev => prev ? {
        ...prev,
        advanceToAdjust: clampedAdjustment,
        netPayable: Math.max(0, netPayable),
        carryForwardAdvance: carryForward,
      } : null);
    }
  }, [advanceToAdjust]);

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
  // Handle leave deduction changes from LeaveDeductionSection
  const handleLeaveDeductionChange = (systemDays: number, finalDays: number, reason?: string) => {
    setSystemDeductionDays(systemDays);
    setFinalDeductionDays(finalDays);
    setDeductionAdjustmentReason(reason || '');
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

      // SAFEGUARD 4: Use journal_lines as single source of truth for advances
      const { data: advanceData, error: advanceError } = await supabase
        .rpc('get_staff_advances_from_journals', {
          _staff_id: selectedStaffId,
        });

      if (advanceError) throw advanceError;

      const monthlySalary = Number(salaryData) || 0;
      const daysInMonth = getDaysInMonth(parseISO(selectedMonth + '-01'));
      // CRITICAL FIX: Use actual days in month for per-day calculation (not hardcoded 30)
      // This ensures accurate leave deduction for 28/29/30/31 day months
      const dailySalary = monthlySalary / daysInMonth;
      // Use finalDeductionDays from leave records (with owner override)
      const leaveDeduction = dailySalary * finalDeductionDays;
      const grossSalary = monthlySalary - leaveDeduction;
      const advancesOutstanding = Number(advanceData) || 0;
      
      // Default: adjust full outstanding (up to gross salary)
      const maxAdjustable = Math.min(advancesOutstanding, grossSalary);
      const defaultAdjustment = maxAdjustable;
      setAdvanceToAdjust(defaultAdjustment);
      
      const netPayable = Math.max(0, grossSalary - defaultAdjustment);
      const carryForwardAdvance = advancesOutstanding - defaultAdjustment;

      const newWarnings = [...warnings.filter(w => !w.includes('leave'))];
      if (finalDeductionDays > 5) {
        newWarnings.push(`High leave deduction (${finalDeductionDays} days) - please verify`);
      }
      if (finalDeductionDays > daysInMonth) {
        newWarnings.push(`Leave deduction exceeds days in month (${daysInMonth})`);
      }
      setWarnings(newWarnings);

      setCalculation({
        monthlySalary,
        dailySalary,
        systemDeductionDays,
        finalDeductionDays,
        deductionAdjustmentReason,
        leaveDeduction,
        grossSalary,
        advancesOutstanding,
        advanceToAdjust: defaultAdjustment,
        netPayable,
        carryForwardAdvance,
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

  const handleAdvanceAdjustmentChange = (amount: number) => {
    if (!calculation) return;
    
    const maxAdjustable = Math.min(calculation.advancesOutstanding, calculation.grossSalary);
    const clampedAmount = Math.min(maxAdjustable, Math.max(0, amount));
    
    setAdvanceToAdjust(clampedAmount);
    
    const netPayable = Math.max(0, calculation.grossSalary - clampedAmount);
    const carryForward = calculation.advancesOutstanding - clampedAmount;
    
    setCalculation({
      ...calculation,
      advanceToAdjust: clampedAmount,
      netPayable,
      carryForwardAdvance: carryForward,
    });
  };

  const handleSettleClick = () => {
    if (!calculation) return;

    const daysInMonth = getDaysInMonth(parseISO(selectedMonth + '-01'));
    
    // VALIDATION 1: Leave days must be valid
    if (finalDeductionDays > 30) {
      toast({
        title: 'Invalid Leave Days',
        description: 'Leave deduction days cannot exceed 30.',
        variant: 'destructive',
      });
      return;
    }

    if (finalDeductionDays > daysInMonth) {
      toast({
        title: 'Invalid Leave Days',
        description: `Leave deduction cannot exceed ${daysInMonth} for this month.`,
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 2: Advance adjustment cannot exceed outstanding advance
    if (calculation.advanceToAdjust > calculation.advancesOutstanding) {
      toast({
        title: 'Invalid Advance Adjustment',
        description: 'Advance adjustment cannot exceed outstanding advance balance.',
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 3: Advance adjustment cannot exceed gross salary
    if (calculation.advanceToAdjust > calculation.grossSalary) {
      toast({
        title: 'Invalid Advance Adjustment',
        description: 'Advance adjustment cannot exceed gross salary.',
        variant: 'destructive',
      });
      return;
    }

    // VALIDATION 4: Net payable must reconcile correctly
    const expectedNetPayable = calculation.grossSalary - calculation.advanceToAdjust;
    if (Math.abs(calculation.netPayable - expectedNetPayable) > 0.01) {
      toast({
        title: 'Calculation Error',
        description: `Net payable (₹${calculation.netPayable}) does not match expected (₹${expectedNetPayable}). Please refresh and try again.`,
        variant: 'destructive',
      });
      console.error('Settlement validation failed:', {
        grossSalary: calculation.grossSalary,
        advanceToAdjust: calculation.advanceToAdjust,
        netPayable: calculation.netPayable,
        expectedNetPayable,
      });
      return;
    }

    // VALIDATION 5: Carry-forward must reconcile
    const expectedCarryForward = calculation.advancesOutstanding - calculation.advanceToAdjust;
    if (Math.abs(calculation.carryForwardAdvance - expectedCarryForward) > 0.01) {
      toast({
        title: 'Calculation Error',
        description: 'Carry-forward advance does not reconcile. Please refresh and try again.',
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
    if (!calculation || !selectedStaffId || !selectedMonth || !user?.id) return;

    if (isAlreadySettled) {
      toast({
        title: 'Already Settled',
        description: 'Salary for this month has already been settled.',
        variant: 'destructive',
      });
      return;
    }

    const staffName = selectedStaff?.full_name || 'Unknown';
    const monthLabel = format(new Date(selectedMonth + '-01'), 'MMMM yyyy');

    try {
      setIsSettling(true);

      // ========================================
      // DOUBLE-ENTRY ACCOUNTING: SALARY SETTLEMENT
      // ========================================
      // This creates the ACCRUAL entries (no cash movement):
      // 1. Debit: Salary Expense (P&L)
      // 2. Credit: Staff Payable (creates liability)
      // 3. If advance adjustment:
      //    - Debit: Staff Payable (reduce liability)
      //    - Credit: Staff Advances (reduce receivable)
      
      // Step 1: Create journal entry for salary settlement
      const journalEntryId = await createSalarySettlementEntry({
        staffId: selectedStaffId,
        staffName,
        settlementMonth: monthLabel,
        grossSalary: calculation.grossSalary,
        leaveDeduction: calculation.leaveDeduction,
        advanceAdjustment: calculation.advanceToAdjust,
        settlementId: '', // Will be updated after settlement record is created
        createdBy: user.id,
      });

      // Step 2: Create settlement record linking to journal entry
      const { data: settlementRecord, error: settlementError } = await supabase
        .from('salary_settlements')
        .insert({
          staff_id: selectedStaffId,
          settlement_month: selectedMonth,
          base_salary: calculation.monthlySalary,
          leave_days: calculation.finalDeductionDays,
          leave_deduction: calculation.leaveDeduction,
          net_salary: calculation.grossSalary,
          advances_adjusted: calculation.advanceToAdjust,
          opening_advance_balance: calculation.advancesOutstanding,
          closing_advance_balance: calculation.carryForwardAdvance,
          balance_payable: calculation.netPayable,
          status: 'settled',
          settled_at: new Date().toISOString(),
          settled_by: user.id,
          journal_entry_id: journalEntryId, // Link to double-entry journal
          system_deduction_days: calculation.systemDeductionDays,
          final_deduction_days: calculation.finalDeductionDays,
          deduction_adjustment_reason: calculation.deductionAdjustmentReason || null,
          deduction_adjusted_by: calculation.finalDeductionDays < calculation.systemDeductionDays ? user.id : null,
          deduction_adjusted_at: calculation.finalDeductionDays < calculation.systemDeductionDays ? new Date().toISOString() : null,
          created_by: user.id,
        })
        .select()
        .single();

      if (settlementError) throw settlementError;

      // Step 3: Update journal entry with settlement reference
      await supabase
        .from('journal_entries')
        .update({ reference_id: settlementRecord.id })
        .eq('id', journalEntryId);

      // Step 4: Mark journal entry as immutable
      await supabase
        .from('journal_entries')
        .update({ is_immutable: true })
        .eq('id', journalEntryId);

      // Step 5: Create salary payout request (if net payable > 0)
      // This will appear in Payouts page for Owner to execute
      // The PAYOUT will create the second journal entry:
      // - Debit: Staff Payable (clear liability)
      // - Credit: Bank/Cash (money out)
      if (calculation.netPayable > 0) {
        const { error: payoutRequestError } = await supabase
          .from('payment_requests')
          .insert({
            staff_id: selectedStaffId,
            requested_by: user.id,
            amount: calculation.netPayable,
            reason: `Salary for ${monthLabel}`,
            status: 'approved',
            approved_by: user.id,
            approved_at: new Date().toISOString(),
            payout_type: 'salary',
            settlement_id: settlementRecord.id,
          });

        if (payoutRequestError) throw payoutRequestError;
      }
      // Mark leave records for this month as immutable
      const monthStart = format(parseISO(selectedMonth + '-01'), 'yyyy-MM-dd');
      const monthEnd = format(new Date(parseISO(selectedMonth + '-01').getFullYear(), parseISO(selectedMonth + '-01').getMonth() + 1, 0), 'yyyy-MM-dd');
      
      await supabase
        .from('leave_records')
        .update({ is_immutable: true })
        .eq('staff_id', selectedStaffId)
        .eq('status', 'approved')
        .gte('leave_date', monthStart)
        .lte('leave_date', monthEnd);

      toast({
        title: 'Salary Settled',
        description: `Salary for ${monthLabel} has been recorded. ${calculation.netPayable > 0 ? 'Go to Payouts to execute payment.' : ''}`,
      });

      // Reset form
      setSelectedStaffId('');
      setSystemDeductionDays(0);
      setFinalDeductionDays(0);
      setDeductionAdjustmentReason('');
      setAdvanceToAdjust(0);
      setCalculation(null);
      setIsAlreadySettled(false);
      setShowConfirmDialog(false);
      setShowZeroPaymentDialog(false);
      
      // Navigate to payouts if there's something to pay
      if (calculation.netPayable > 0) {
        navigate('/payouts');
      }
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
  const canSettle = calculation && !isAlreadySettled && validation?.valid !== false && finalDeductionDays <= 30;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Salary Settlement"
        description="Process monthly settlements"
      >
        <Button variant="ghost" size="sm" onClick={() => navigate('/salaries-advances')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
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

            {/* Leave Deduction Section - Integrated with Leave Records */}
            {selectedStaffId && selectedMonth && !isAlreadySettled && (
              <LeaveDeductionSection
                staffId={selectedStaffId}
                month={selectedMonth}
                dailySalary={calculation?.dailySalary || 0}
                onDeductionChange={handleLeaveDeductionChange}
                disabled={isAlreadySettled}
              />
            )}

            {/* Partial Advance Adjustment */}
            {calculation && calculation.advancesOutstanding > 0 && !isAlreadySettled && (
              <AdvanceAdjustmentInput
                totalAdvanceOutstanding={calculation.advancesOutstanding}
                grossSalary={calculation.grossSalary}
                adjustmentAmount={calculation.advanceToAdjust}
                onAdjustmentChange={handleAdvanceAdjustmentChange}
                disabled={isAlreadySettled}
              />
            )}

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
                    Leave Deduction ({calculation.finalDeductionDays} days × ₹{calculation.dailySalary.toFixed(2)})
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
                  <>
                    <div className="flex justify-between items-center py-2 text-sm">
                      <span className="text-muted-foreground">Opening Advance Balance</span>
                      <Amount value={calculation.advancesOutstanding} className="text-warning" />
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-muted-foreground">Advance Adjusted</span>
                      <span className="text-destructive font-medium">
                        -<Amount value={calculation.advanceToAdjust} />
                      </span>
                    </div>
                    {calculation.carryForwardAdvance > 0 && (
                      <div className="flex justify-between items-center py-2 text-sm">
                        <span className="text-muted-foreground">Carry Forward</span>
                        <Amount value={calculation.carryForwardAdvance} className="text-warning" />
                      </div>
                    )}
                  </>
                )}
                
                <Separator />
                
                <div className="flex justify-between items-center py-3 bg-primary/5 rounded-lg px-4 -mx-4">
                  <span className="font-semibold text-lg">Net Payable</span>
                  <Amount value={calculation.netPayable} size="lg" className="font-bold text-primary" />
                </div>
                
                {calculation.carryForwardAdvance > 0 && (
                  <Alert className="border-info bg-info/10">
                    <Info className="h-4 w-4 text-info" />
                    <AlertDescription className="text-info">
                      ₹{calculation.carryForwardAdvance.toLocaleString('en-IN')} advance will carry forward to next month.
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
          <EnhancedSettlementConfirmDialog
            open={showConfirmDialog}
            onOpenChange={setShowConfirmDialog}
            onConfirm={handleSettle}
            isLoading={isSettling}
            staffName={selectedStaff.full_name}
            month={format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
            snapshot={{
              baseSalary: calculation.monthlySalary,
              leaveDays: calculation.finalDeductionDays,
              leaveDeduction: calculation.leaveDeduction,
              grossSalary: calculation.grossSalary,
              openingAdvanceBalance: calculation.advancesOutstanding,
              advanceAdjusted: calculation.advanceToAdjust,
              closingAdvanceBalance: calculation.carryForwardAdvance,
              netPayable: calculation.netPayable,
              systemDeductionDays: calculation.systemDeductionDays,
            }}
            paymentMode={paymentMode}
          />
          
          <ZeroPaymentConfirmDialog
            open={showZeroPaymentDialog}
            onOpenChange={setShowZeroPaymentDialog}
            onConfirm={handleSettle}
            isLoading={isSettling}
            staffName={selectedStaff.full_name}
            month={format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
            reason={`Advances adjusted (₹${calculation.advanceToAdjust.toLocaleString('en-IN')}) equal gross salary`}
          />
        </>
      )}
    </div>
  );
}
