import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Amount } from '@/components/ui/amount';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  BarChart3, Download, CalendarIcon, FileSpreadsheet, FileText, Users, Wallet,
  ArrowUpRight, Receipt, FileDown, Scale, Sparkles, ListOrdered,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, parse } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  exportLedgerPDF, exportSalaryRegisterPDF, exportPaymentRegisterPDF,
  exportExpenseReportPDF, exportAdvanceReportPDF, exportSummaryPDF,
} from '@/lib/pdf-export';
import { TrialBalance } from '@/components/reports/TrialBalance';
import { ExpenseExplorer } from '@/components/reports/ExpenseExplorer';
import { AdvanceExplorer } from '@/components/reports/AdvanceExplorer';
import { TransactionsExplorer } from '@/components/reports/TransactionsExplorer';
import { AIInsights } from '@/components/reports/AIInsights';
import type { Staff } from '@/types/database';

type ReportType = 'expenses' | 'advances' | 'transactions' | 'ai_insights' | 'summary' | 'trial_balance' | 'ledger' | 'salary' | 'payment';

interface DateRange { from: Date; to: Date; }

const REPORT_TYPES: ReportType[] = ['expenses', 'advances', 'transactions', 'ai_insights', 'summary', 'trial_balance', 'ledger', 'salary', 'payment'];

/** Map dashboard deep-link values (?type=salary-register etc.) to a report tab. */
function reportFromParam(param: string | null, canSeeSalary: boolean): ReportType {
  switch (param) {
    case 'salary-register': return canSeeSalary ? 'salary' : 'summary';
    case 'payment-register': return 'payment';
    case 'advance-register': return 'advances';
    case 'payroll-summary': return 'summary';
    default:
      if (param && (REPORT_TYPES as string[]).includes(param)) {
        return param === 'salary' && !canSeeSalary ? 'summary' : (param as ReportType);
      }
      return 'expenses';
  }
}

export default function Reports() {
  const navigate = useNavigate();
  const { isOwner, isCA, isAccountant, isAdmin, canViewSalaries } = useAuth();
  const canSeeSalaryReports = canViewSalaries;

  const [searchParams] = useSearchParams();
  const [activeReport, setActiveReport] = useState<ReportType>(() =>
    reportFromParam(searchParams.get('type'), canSeeSalaryReports),
  );
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('all');
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(new Date()),
  });
  const tabsListRef = useRef<HTMLDivElement>(null);
  const [reportData, setReportData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summaryStats, setSummaryStats] = useState({
    totalPayroll: 0, totalAdvances: 0, totalExpenses: 0, totalPayments: 0, staffCount: 0,
  });

  useEffect(() => {
    if (!isOwner && !isCA && !isAccountant && !isAdmin) {
      toast({ title: 'Access Denied', description: 'You do not have permission to view reports.', variant: 'destructive' });
      navigate('/dashboard');
      return;
    }
    fetchStaff();
  }, [isOwner, isCA, isAccountant, isAdmin]);

  useEffect(() => {
    setReportData([]);
    if (['summary', 'ledger', 'salary', 'payment'].includes(activeReport)) {
      fetchReportData();
    }
  }, [activeReport, selectedStaffId, selectedMonth, dateRange]);

  // Keep the selected tab visible in the horizontally scrolling tab row (e.g. after a deep link)
  useEffect(() => {
    const active = tabsListRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeReport]);

  const fetchStaff = async () => {
    const { data } = await supabase.from('staff_public').select('*').order('full_name');
    setStaff(data as Staff[] || []);
  };

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      switch (activeReport) {
        case 'summary': await fetchSummaryReport(); break;
        case 'ledger': await fetchLedgerReport(); break;
        case 'salary': await fetchSalaryReport(); break;
        case 'payment': await fetchPaymentReport(); break;
      }
    } catch (error) {
      console.error('Error fetching report:', error);
      toast({ title: 'Error', description: 'Failed to load report data.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSummaryReport = async () => {
    // Real month bounds (a fixed "-31" is an invalid DATE for 30-day months and February)
    const monthDate = parse(selectedMonth, 'yyyy-MM', new Date());
    const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd');
    const [staffData, settlements, advances, expenses] = await Promise.all([
      supabase.from('staff').select('id, monthly_salary').eq('is_active', true),
      supabase.from('salary_settlements').select('balance_payable').eq('settlement_month', selectedMonth).eq('status', 'settled'),
      supabase.from('ledger_entries').select('debit, credit').eq('tag', 'advance').gte('entry_date', monthStart).lte('entry_date', monthEnd),
      supabase.from('expenses').select('amount').eq('status', 'reimbursed').gte('expense_date', monthStart).lte('expense_date', monthEnd),
    ]);
    const firstError = staffData.error || settlements.error || advances.error || expenses.error;
    if (firstError) throw firstError;

    setSummaryStats({
      totalPayroll: staffData.data?.reduce((sum, s) => sum + Number(s.monthly_salary), 0) || 0,
      totalAdvances: advances.data?.reduce((sum, a) => sum + Number(a.debit) - Number(a.credit), 0) || 0,
      totalExpenses: expenses.data?.reduce((sum, e) => sum + Number(e.amount), 0) || 0,
      totalPayments: settlements.data?.reduce((sum, s) => sum + Number(s.balance_payable), 0) || 0,
      staffCount: staffData.data?.length || 0,
    });
  };

  const fetchLedgerReport = async () => {
    let query = supabase
      .from('journal_lines')
      .select(`
        id, debit, credit, description, staff_id, created_at,
        journal_entry:journal_entry_id(id, entry_date, reference_no, description, transaction_type, is_immutable, paid_by_user_name),
        account:account_id(code, name, account_type)
      `)
      .not('staff_id', 'is', null)
      .order('created_at', { ascending: true });

    if (selectedStaffId !== 'all') query = query.eq('staff_id', selectedStaffId);

    const { data, error } = await query;
    if (error) throw error;

    // Filter by date range using journal_entry.entry_date
    const fromStr = format(dateRange.from, 'yyyy-MM-dd');
    const toStr = format(dateRange.to, 'yyyy-MM-dd');
    const filtered = (data || []).filter((line: any) => {
      const entryDate = line.journal_entry?.entry_date;
      return entryDate && entryDate >= fromStr && entryDate <= toStr;
    });
    setReportData(filtered);
  };

  const fetchSalaryReport = async () => {
    let query = supabase.from('salary_settlements').select('*, staff:staff_public(full_name, employee_id)')
      .eq('settlement_month', selectedMonth).order('created_at', { ascending: false });
    if (selectedStaffId !== 'all') query = query.eq('staff_id', selectedStaffId);
    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const fetchPaymentReport = async () => {
    let query = supabase
      .from('journal_entries')
      .select(`
        id, entry_date, reference_no, description, transaction_type, paid_by_user_name,
        staff:staff_public(full_name, employee_id),
        lines:journal_lines(id, debit, credit, account:accounts(code, name))
      `)
      .in('transaction_type', ['salary_payout', 'expense_payout', 'advance_paid'])
      .gte('entry_date', format(dateRange.from, 'yyyy-MM-dd'))
      .lte('entry_date', format(dateRange.to, 'yyyy-MM-dd'))
      .order('entry_date', { ascending: false });

    if (selectedStaffId !== 'all') query = query.eq('staff_id', selectedStaffId);
    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return { value: format(date, 'yyyy-MM'), label: format(date, 'MMMM yyyy') };
  });

  const handlePDFExport = () => {
    const selectedStaffName = staff.find(s => s.id === selectedStaffId)?.full_name || 'All Staff';
    switch (activeReport) {
      case 'summary': exportSummaryPDF(summaryStats, selectedMonth); break;
      case 'ledger':
        // Journal lines nest the entry fields; flatten to the shape exportLedgerPDF expects
        exportLedgerPDF(
          reportData.map((line) => ({
            entry_date: line.journal_entry?.entry_date || line.created_at,
            voucher_no: line.journal_entry?.reference_no || '',
            description: line.journal_entry?.description || line.description || '',
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
          })),
          selectedStaffName,
          dateRange,
        );
        break;
      case 'salary': exportSalaryRegisterPDF(reportData, selectedMonth, canViewSalaries); break;
      case 'payment': exportPaymentRegisterPDF(reportData, dateRange); break;
    }
    toast({ title: 'PDF Exported', description: 'Report downloaded.' });
  };

  const needsFilters = ['summary', 'ledger', 'salary', 'payment'].includes(activeReport);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader title="Reports" description="Smart reports & AI-powered insights for decision-making">
        {needsFilters && (
          <div className="flex gap-2">
            <Button size="sm" onClick={handlePDFExport} disabled={activeReport === 'summary' ? false : reportData.length === 0} aria-label="Download PDF">
              <FileDown className="mr-1.5 h-4 w-4" /><span className="hidden sm:inline">PDF</span>
            </Button>
          </div>
        )}
      </PageHeader>

      <Tabs value={activeReport} onValueChange={v => setActiveReport(v as ReportType)}>
        <div className="min-w-0">
          {/* One horizontally scrollable row (TabsList scrolls) instead of a tall wrapped grid on phones */}
          <TabsList ref={tabsListRef} className="h-auto w-full justify-start gap-1 sm:w-full">
            <TabsTrigger value="expenses" className="shrink-0 gap-1 px-3">
              <Receipt className="h-4 w-4" /><span className="text-xs sm:text-sm">Expenses</span>
            </TabsTrigger>
            <TabsTrigger value="advances" className="shrink-0 gap-1 px-3">
              <ArrowUpRight className="h-4 w-4" /><span className="text-xs sm:text-sm">Advances</span>
            </TabsTrigger>
            <TabsTrigger value="transactions" className="shrink-0 gap-1 px-3">
              <ListOrdered className="h-4 w-4" /><span className="text-xs sm:text-sm">Transactions</span>
            </TabsTrigger>
            <TabsTrigger value="ai_insights" className="shrink-0 gap-1 px-3">
              <Sparkles className="h-4 w-4" /><span className="text-xs sm:text-sm">AI Insights</span>
            </TabsTrigger>
            <TabsTrigger value="summary" className="shrink-0 gap-1 px-3">
              <BarChart3 className="h-4 w-4" /><span className="text-xs sm:text-sm">Summary</span>
            </TabsTrigger>
            <TabsTrigger value="trial_balance" className="shrink-0 gap-1 px-3">
              <Scale className="h-4 w-4" /><span className="text-xs sm:text-sm">Trial Balance</span>
            </TabsTrigger>
            <TabsTrigger value="ledger" className="shrink-0 gap-1 px-3">
              <FileText className="h-4 w-4" /><span className="text-xs sm:text-sm">Ledger</span>
            </TabsTrigger>
            {canSeeSalaryReports && (
              <TabsTrigger value="salary" className="shrink-0 gap-1 px-3">
                <Wallet className="h-4 w-4" /><span className="text-xs sm:text-sm">Salary</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="payment" className="shrink-0 gap-1 px-3">
              <FileSpreadsheet className="h-4 w-4" /><span className="text-xs sm:text-sm">Payments</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Filters for legacy reports */}
        {needsFilters && (
          <Card className="mt-4">
            <CardContent className="pt-4 px-3 sm:px-6">
              <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-4">
                {activeReport !== 'summary' && (
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Staff</Label>
                    <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                      <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="All Staff" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Staff</SelectItem>
                        {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(activeReport === 'summary' || activeReport === 'salary') && (
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <Label className="text-xs">Month</Label>
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                      <SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {monthOptions.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(activeReport === 'ledger' || activeReport === 'payment') && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">From</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full sm:w-[140px] justify-start text-left font-normal text-xs sm:text-sm">
                            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />{format(dateRange.from, 'dd MMM yy')}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={dateRange.from} onSelect={d => d && setDateRange(p => ({ ...p, from: d }))} className="p-3 pointer-events-auto" /></PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">To</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full sm:w-[140px] justify-start text-left font-normal text-xs sm:text-sm">
                            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />{format(dateRange.to, 'dd MMM yy')}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={dateRange.to} onSelect={d => d && setDateRange(p => ({ ...p, to: d }))} className="p-3 pointer-events-auto" /></PopoverContent>
                      </Popover>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== NEW SMART TABS ===== */}
        <TabsContent value="expenses" className="mt-4"><ExpenseExplorer /></TabsContent>
        <TabsContent value="advances" className="mt-4"><AdvanceExplorer /></TabsContent>
        <TabsContent value="transactions" className="mt-4"><TransactionsExplorer /></TabsContent>
        <TabsContent value="ai_insights" className="mt-4"><AIInsights /></TabsContent>

        {/* ===== LEGACY TABS (kept for CA/accounting) ===== */}
        <TabsContent value="summary" className="mt-4">
          <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", canSeeSalaryReports ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
            <Card><CardHeader className="pb-2 p-3 sm:p-6"><CardDescription className="text-xs sm:text-sm">Active Staff</CardDescription><CardTitle className="text-xl sm:text-2xl">{summaryStats.staffCount}</CardTitle></CardHeader></Card>
            {canSeeSalaryReports && (
              <Card><CardHeader className="pb-2 p-3 sm:p-6"><CardDescription className="text-xs sm:text-sm">Monthly Payroll</CardDescription><CardTitle className="text-xl sm:text-2xl"><Amount value={summaryStats.totalPayroll} className="text-foreground" /></CardTitle></CardHeader></Card>
            )}
            <Card><CardHeader className="pb-2 p-3 sm:p-6"><CardDescription className="text-xs sm:text-sm">Advances Outstanding</CardDescription><CardTitle className="text-xl sm:text-2xl"><Amount value={summaryStats.totalAdvances} className="text-warning" /></CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2 p-3 sm:p-6"><CardDescription className="text-xs sm:text-sm">Expenses Reimbursed</CardDescription><CardTitle className="text-xl sm:text-2xl"><Amount value={summaryStats.totalExpenses} className="text-foreground" /></CardTitle></CardHeader></Card>
          </div>
        </TabsContent>

        <TabsContent value="trial_balance" className="mt-4"><TrialBalance /></TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Staff Ledger Report</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div> : (
                <>
                <div className="divide-y md:hidden">{reportData.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No entries found</p>}{reportData.map((line: any) => <div key={line.id} className="space-y-2 py-4"><div className="flex justify-between gap-3"><span className="font-medium">{line.account?.name || line.account?.code}</span><span className="shrink-0 text-xs text-muted-foreground">{line.journal_entry?.entry_date ? format(new Date(line.journal_entry.entry_date), 'dd MMM yyyy') : '-'}</span></div><p className="break-words text-xs text-muted-foreground">{line.journal_entry?.description || line.description}</p><div className="flex justify-between gap-3 text-xs"><span className="font-mono">{line.journal_entry?.reference_no}</span><span>{Number(line.debit) > 0 ? <>Debit <Amount value={line.debit} /></> : <>Credit <Amount value={line.credit} /></>}</span></div></div>)}</div>
                <div className="hidden md:block"><Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Ref No</TableHead><TableHead>Account</TableHead>
                    <TableHead>Description</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {reportData.map((line: any) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.journal_entry?.entry_date ? format(new Date(line.journal_entry.entry_date), 'dd MMM yyyy') : '-'}</TableCell>
                        <TableCell className="font-mono text-xs">{line.journal_entry?.reference_no}</TableCell>
                        <TableCell className="text-sm">{line.account?.name || line.account?.code}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{line.journal_entry?.description || line.description}</TableCell>
                        <TableCell className="text-right">{Number(line.debit) > 0 && <Amount value={line.debit} />}</TableCell>
                        <TableCell className="text-right">{Number(line.credit) > 0 && <Amount value={line.credit} />}</TableCell>
                      </TableRow>
                    ))}
                    {reportData.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No entries found</TableCell></TableRow>}
                  </TableBody>
                </Table></div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canSeeSalaryReports && (
          <TabsContent value="salary" className="mt-4">
            <Card>
              <CardHeader><CardTitle>Salary Register - {selectedMonth ? format(new Date(selectedMonth + '-01'), 'MMMM yyyy') : ''}</CardTitle></CardHeader>
              <CardContent>
                {isLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div> : (
                  <>
                  <div className="divide-y md:hidden">{reportData.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No settlements for this month</p>}{reportData.map((settlement: any) => <div key={settlement.id} className="space-y-2 py-4"><div className="flex items-start justify-between gap-3"><span className="font-medium">{settlement.staff?.full_name}</span><Amount value={settlement.balance_payable} /></div><div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>Base: ₹{Number(settlement.base_salary).toLocaleString('en-IN')}</span><span className="text-right">Leave: {settlement.leave_days} days</span><span>Deduction: ₹{Number(settlement.leave_deduction).toLocaleString('en-IN')}</span><span className="text-right">Advance: ₹{Number(settlement.advances_adjusted).toLocaleString('en-IN')}</span></div></div>)}</div>
                  <div className="hidden md:block"><Table>
                    <TableHeader><TableRow>
                      <TableHead>Staff</TableHead><TableHead className="text-right">Base Salary</TableHead>
                      <TableHead className="text-right">Leave Days</TableHead><TableHead className="text-right">Deduction</TableHead>
                      <TableHead className="text-right">Net Salary</TableHead><TableHead className="text-right">Advances Adj.</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {reportData.map(s => (
                        <TableRow key={s.id}>
                          <TableCell>{s.staff?.full_name}</TableCell>
                          <TableCell className="text-right"><Amount value={s.base_salary} /></TableCell>
                          <TableCell className="text-right">{s.leave_days}</TableCell>
                          <TableCell className="text-right"><Amount value={s.leave_deduction} /></TableCell>
                          <TableCell className="text-right"><Amount value={s.net_salary} /></TableCell>
                          <TableCell className="text-right"><Amount value={s.advances_adjusted} /></TableCell>
                          <TableCell className="text-right font-medium"><Amount value={s.balance_payable} /></TableCell>
                        </TableRow>
                      ))}
                      {reportData.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No settlements for this month</TableCell></TableRow>}
                    </TableBody>
                  </Table></div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="payment" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Payment Register</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" /></div> : (
                <>
                <div className="divide-y md:hidden">{reportData.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No payments found</p>}{reportData.map((entry: any) => { const amount = (entry.lines || []).reduce((sum: number, line: any) => sum + (Number(line.debit) || 0), 0) / 2; return <div key={entry.id} className="space-y-2 py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{entry.staff?.full_name || '-'}</p><p className="text-xs text-muted-foreground">{entry.entry_date ? format(new Date(entry.entry_date), 'dd MMM yyyy') : '-'}</p></div><Amount value={amount} /></div><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{entry.transaction_type?.replace(/_/g, ' ')}</span><span className="font-mono">{entry.reference_no}</span><span>{entry.paid_by_user_name || '-'}</span></div></div>; })}</div>
                <div className="hidden md:block"><Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Ref No</TableHead><TableHead>Staff</TableHead>
                    <TableHead>Type</TableHead><TableHead>Paid By</TableHead><TableHead className="text-right">Amount</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {reportData.map((entry: any) => {
                      const amount = (entry.lines || []).reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0) / 2;
                      const typeLabel = entry.transaction_type?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>{entry.entry_date ? format(new Date(entry.entry_date), 'dd MMM yyyy') : '-'}</TableCell>
                          <TableCell className="font-mono text-xs">{entry.reference_no}</TableCell>
                          <TableCell>{entry.staff?.full_name || '-'}</TableCell>
                          <TableCell className="capitalize text-sm">{typeLabel}</TableCell>
                          <TableCell className="text-sm">{entry.paid_by_user_name || '-'}</TableCell>
                          <TableCell className="text-right"><Amount value={amount} /></TableCell>
                        </TableRow>
                      );
                    })}
                    {reportData.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No payments found</TableCell></TableRow>}
                  </TableBody>
                </Table></div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
