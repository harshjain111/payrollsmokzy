import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { 
  BarChart3, 
  Download, 
  CalendarIcon, 
  FileSpreadsheet,
  FileText,
  Users,
  Wallet,
  ArrowUpRight,
  Receipt,
  FileDown,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  exportLedgerPDF,
  exportSalaryRegisterPDF,
  exportPaymentRegisterPDF,
  exportExpenseReportPDF,
  exportAdvanceReportPDF,
  exportSummaryPDF,
} from '@/lib/pdf-export';
import type { Staff } from '@/types/database';

type ReportType = 'ledger' | 'salary' | 'advance' | 'expense' | 'payment' | 'summary';

interface DateRange {
  from: Date;
  to: Date;
}

export default function Reports() {
  const navigate = useNavigate();
  const { isOwner, isCA, isAccountant, isAdmin, canViewSalaries } = useAuth();
  
  // Determine if user can see salary-related reports
  const canSeeSalaryReports = canViewSalaries;
  
  const [activeReport, setActiveReport] = useState<ReportType>('summary');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(new Date()),
  });
  const [reportData, setReportData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [summaryStats, setSummaryStats] = useState({
    totalPayroll: 0,
    totalAdvances: 0,
    totalExpenses: 0,
    totalPayments: 0,
    staffCount: 0,
  });

  useEffect(() => {
    if (!isOwner && !isCA && !isAccountant && !isAdmin) {
      toast({
        title: 'Access Denied',
        description: 'You do not have permission to view reports.',
        variant: 'destructive',
      });
      navigate('/dashboard');
      return;
    }
    fetchStaff();
  }, [isOwner, isCA, isAccountant, isAdmin]);

  useEffect(() => {
    fetchReportData();
  }, [activeReport, selectedStaffId, selectedMonth, dateRange]);

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('staff_public')
        .select('*')
        .order('full_name');

      if (error) throw error;
      setStaff(data as Staff[] || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };

  const fetchReportData = async () => {
    setIsLoading(true);
    try {
      switch (activeReport) {
        case 'summary':
          await fetchSummaryReport();
          break;
        case 'ledger':
          await fetchLedgerReport();
          break;
        case 'salary':
          await fetchSalaryReport();
          break;
        case 'advance':
          await fetchAdvanceReport();
          break;
        case 'expense':
          await fetchExpenseReport();
          break;
        case 'payment':
          await fetchPaymentReport();
          break;
      }
    } catch (error) {
      console.error('Error fetching report:', error);
      toast({
        title: 'Error',
        description: 'Failed to load report data.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSummaryReport = async () => {
    // Get staff count
    const { data: staffData } = await supabase
      .from('staff')
      .select('id, monthly_salary')
      .eq('is_active', true);

    // Get salary settlements for the month
    const { data: settlements } = await supabase
      .from('salary_settlements')
      .select('balance_payable')
      .eq('settlement_month', selectedMonth)
      .eq('status', 'settled');

    // Get advances
    const { data: advances } = await supabase
      .from('ledger_entries')
      .select('debit, credit')
      .eq('tag', 'advance')
      .gte('entry_date', `${selectedMonth}-01`)
      .lte('entry_date', `${selectedMonth}-31`);

    // Get expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount')
      .eq('status', 'reimbursed')
      .gte('expense_date', `${selectedMonth}-01`)
      .lte('expense_date', `${selectedMonth}-31`);

    const totalPayroll = staffData?.reduce((sum, s) => sum + Number(s.monthly_salary), 0) || 0;
    const totalSettled = settlements?.reduce((sum, s) => sum + Number(s.balance_payable), 0) || 0;
    const totalAdvances = advances?.reduce((sum, a) => sum + Number(a.debit) - Number(a.credit), 0) || 0;
    const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    setSummaryStats({
      totalPayroll,
      totalAdvances,
      totalExpenses,
      totalPayments: totalSettled,
      staffCount: staffData?.length || 0,
    });
  };

  const fetchLedgerReport = async () => {
    let query = supabase
      .from('ledger_entries')
      .select(`
        *,
        staff:staff_public(full_name, employee_id)
      `)
      .gte('entry_date', format(dateRange.from, 'yyyy-MM-dd'))
      .lte('entry_date', format(dateRange.to, 'yyyy-MM-dd'))
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (selectedStaffId !== 'all') {
      query = query.eq('staff_id', selectedStaffId);
    }

    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const fetchSalaryReport = async () => {
    let query = supabase
      .from('salary_settlements')
      .select(`
        *,
        staff:staff_public(full_name, employee_id)
      `)
      .eq('settlement_month', selectedMonth)
      .order('created_at', { ascending: false });

    if (selectedStaffId !== 'all') {
      query = query.eq('staff_id', selectedStaffId);
    }

    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const fetchAdvanceReport = async () => {
    // Get outstanding advances per staff
    const { data, error } = await supabase
      .from('ledger_entries')
      .select(`
        staff_id,
        debit,
        credit,
        staff:staff_public(full_name, employee_id)
      `)
      .eq('tag', 'advance');

    if (error) throw error;

    // Group by staff
    const advancesByStaff = (data || []).reduce((acc: any, entry: any) => {
      const staffId = entry.staff_id;
      if (!acc[staffId]) {
        acc[staffId] = {
          staff: entry.staff,
          totalAdvances: 0,
          totalAdjusted: 0,
        };
      }
      acc[staffId].totalAdvances += Number(entry.debit) || 0;
      acc[staffId].totalAdjusted += Number(entry.credit) || 0;
      return acc;
    }, {});

    const result = Object.values(advancesByStaff).map((item: any) => ({
      ...item,
      outstanding: item.totalAdvances - item.totalAdjusted,
    })).filter((item: any) => item.outstanding > 0);

    setReportData(result);
  };

  const fetchExpenseReport = async () => {
    let query = supabase
      .from('expenses')
      .select(`
        *,
        staff:staff_public(full_name, employee_id)
      `)
      .eq('status', 'reimbursed')
      .gte('expense_date', format(dateRange.from, 'yyyy-MM-dd'))
      .lte('expense_date', format(dateRange.to, 'yyyy-MM-dd'))
      .order('expense_date', { ascending: false });

    if (selectedStaffId !== 'all') {
      query = query.eq('staff_id', selectedStaffId);
    }

    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const fetchPaymentReport = async () => {
    let query = supabase
      .from('ledger_entries')
      .select(`
        *,
        staff:staff_public(full_name, employee_id)
      `)
      .in('voucher_type', ['payment', 'settlement', 'advance'])
      .gte('entry_date', format(dateRange.from, 'yyyy-MM-dd'))
      .lte('entry_date', format(dateRange.to, 'yyyy-MM-dd'))
      .order('entry_date', { ascending: false });

    if (selectedStaffId !== 'all') {
      query = query.eq('staff_id', selectedStaffId);
    }

    const { data, error } = await query;
    if (error) throw error;
    setReportData(data || []);
  };

  const exportToCSV = () => {
    if (reportData.length === 0) {
      toast({ title: 'No data', description: 'No data to export.', variant: 'destructive' });
      return;
    }

    // Create CSV content based on report type
    let csvContent = '';
    let headers: string[] = [];
    let rows: string[][] = [];

    switch (activeReport) {
      case 'ledger':
        headers = ['Date', 'Voucher No', 'Staff', 'Description', 'Debit', 'Credit', 'Tag'];
        rows = reportData.map(r => [
          format(new Date(r.entry_date), 'dd/MM/yyyy'),
          r.voucher_no,
          r.staff?.full_name || '',
          r.description,
          r.debit?.toString() || '0',
          r.credit?.toString() || '0',
          r.tag || '',
        ]);
        break;
      case 'salary':
        headers = ['Month', 'Staff', 'Base Salary', 'Leave Days', 'Deduction', 'Net Salary', 'Advances Adjusted', 'Paid'];
        rows = reportData.map(r => [
          r.settlement_month,
          r.staff?.full_name || '',
          r.base_salary?.toString() || '0',
          r.leave_days?.toString() || '0',
          r.leave_deduction?.toString() || '0',
          r.net_salary?.toString() || '0',
          r.advances_adjusted?.toString() || '0',
          r.balance_payable?.toString() || '0',
        ]);
        break;
      case 'advance':
        headers = ['Staff', 'Employee ID', 'Total Advances', 'Adjusted', 'Outstanding'];
        rows = reportData.map(r => [
          r.staff?.full_name || '',
          r.staff?.employee_id || '',
          r.totalAdvances?.toString() || '0',
          r.totalAdjusted?.toString() || '0',
          r.outstanding?.toString() || '0',
        ]);
        break;
      default:
        break;
    }

    csvContent = headers.join(',') + '\n';
    csvContent += rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${activeReport}_report_${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();

    toast({ title: 'Export Complete', description: 'Report downloaded as CSV.' });
  };

  // Generate month options
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  });

  const handlePDFExport = () => {
    const selectedStaffName = staff.find(s => s.id === selectedStaffId)?.full_name || 'All Staff';
    
    switch (activeReport) {
      case 'summary':
        exportSummaryPDF(summaryStats, selectedMonth);
        toast({ title: 'PDF Exported', description: 'Summary report downloaded.' });
        break;
      case 'ledger':
        exportLedgerPDF(reportData, selectedStaffName, dateRange);
        toast({ title: 'PDF Exported', description: 'Ledger report downloaded.' });
        break;
      case 'salary':
        exportSalaryRegisterPDF(reportData, selectedMonth, canViewSalaries);
        toast({ title: 'PDF Exported', description: 'Salary register downloaded.' });
        break;
      case 'advance':
        exportAdvanceReportPDF(reportData);
        toast({ title: 'PDF Exported', description: 'Advance report downloaded.' });
        break;
      case 'payment':
        exportPaymentRegisterPDF(reportData, dateRange);
        toast({ title: 'PDF Exported', description: 'Payment register downloaded.' });
        break;
      case 'expense':
        exportExpenseReportPDF(reportData, dateRange);
        toast({ title: 'PDF Exported', description: 'Expense report downloaded.' });
        break;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generate and export accounting reports"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToCSV} disabled={reportData.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button onClick={handlePDFExport} disabled={activeReport === 'summary' ? false : reportData.length === 0}>
            <FileDown className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </PageHeader>

      <Tabs value={activeReport} onValueChange={(v) => setActiveReport(v as ReportType)}>
        <TabsList className={cn("grid gap-1", canSeeSalaryReports ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-4")}>
          <TabsTrigger value="summary" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Summary</span>
          </TabsTrigger>
          <TabsTrigger value="ledger" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Ledger</span>
          </TabsTrigger>
          {canSeeSalaryReports && (
            <TabsTrigger value="salary" className="flex items-center gap-1">
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Salary</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="advance" className="flex items-center gap-1">
            <ArrowUpRight className="h-4 w-4" />
            <span className="hidden sm:inline">Advances</span>
          </TabsTrigger>
          <TabsTrigger value="expense" className="flex items-center gap-1">
            <Receipt className="h-4 w-4" />
            <span className="hidden sm:inline">Expenses</span>
          </TabsTrigger>
          <TabsTrigger value="payment" className="flex items-center gap-1">
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">Payments</span>
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <Card className="mt-4">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4">
              {activeReport !== 'advance' && (
                <div className="space-y-1">
                  <Label className="text-xs">Staff</Label>
                  <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Staff</SelectItem>
                      {staff.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(activeReport === 'summary' || activeReport === 'salary') && (
                <div className="space-y-1">
                  <Label className="text-xs">Month</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="w-[180px]">
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
              )}

              {(activeReport === 'ledger' || activeReport === 'expense' || activeReport === 'payment') && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-[140px] justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(dateRange.from, 'dd MMM yy')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={dateRange.from}
                          onSelect={(date) => date && setDateRange(prev => ({ ...prev, from: date }))}
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-[140px] justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(dateRange.to, 'dd MMM yy')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={dateRange.to}
                          onSelect={(date) => date && setDateRange(prev => ({ ...prev, to: date }))}
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Report Content */}
        {/* Summary - hide salary-related stats for non-owners */}
        <TabsContent value="summary" className="mt-4">
          <div className={cn("grid gap-4", canSeeSalaryReports ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3")}>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Active Staff</CardDescription>
                <CardTitle className="text-2xl">{summaryStats.staffCount}</CardTitle>
              </CardHeader>
            </Card>
            {canSeeSalaryReports && (
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Monthly Payroll</CardDescription>
                  <CardTitle className="text-2xl">
                    <Amount value={summaryStats.totalPayroll} className="text-foreground" />
                  </CardTitle>
                </CardHeader>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Advances Outstanding</CardDescription>
                <CardTitle className="text-2xl">
                  <Amount value={summaryStats.totalAdvances} className="text-warning" />
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Expenses Reimbursed</CardDescription>
                <CardTitle className="text-2xl">
                  <Amount value={summaryStats.totalExpenses} className="text-foreground" />
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff Ledger Report</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{format(new Date(entry.entry_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.voucher_no}</TableCell>
                        <TableCell>{entry.staff?.full_name}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                        <TableCell className="text-right">
                          {entry.debit > 0 && <Amount value={entry.debit} />}
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.credit > 0 && <Amount value={entry.credit} />}
                        </TableCell>
                      </TableRow>
                    ))}
                    {reportData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No entries found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Salary Report - Only for owners */}
        {canSeeSalaryReports && (
          <TabsContent value="salary" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Salary Register - {format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff</TableHead>
                        <TableHead className="text-right">Base Salary</TableHead>
                        <TableHead className="text-right">Leave Days</TableHead>
                        <TableHead className="text-right">Deduction</TableHead>
                        <TableHead className="text-right">Net Salary</TableHead>
                        <TableHead className="text-right">Advances Adj.</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportData.map((settlement) => (
                        <TableRow key={settlement.id}>
                          <TableCell>{settlement.staff?.full_name}</TableCell>
                          <TableCell className="text-right">
                            <Amount value={settlement.base_salary} />
                          </TableCell>
                          <TableCell className="text-right">{settlement.leave_days}</TableCell>
                          <TableCell className="text-right">
                            <Amount value={settlement.leave_deduction} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={settlement.net_salary} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={settlement.advances_adjusted} />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <Amount value={settlement.balance_payable} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {reportData.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            No settlements for this month
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="advance" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Advances Outstanding Report</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead className="text-right">Total Advances</TableHead>
                      <TableHead className="text-right">Adjusted</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.staff?.full_name}</TableCell>
                        <TableCell>{item.staff?.employee_id}</TableCell>
                        <TableCell className="text-right">
                          <Amount value={item.totalAdvances} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Amount value={item.totalAdjusted} />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <Amount value={item.outstanding} className="text-warning" />
                        </TableCell>
                      </TableRow>
                    ))}
                    {reportData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No outstanding advances
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expense" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Expense Reimbursement Report</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((expense) => (
                      <TableRow key={expense.id}>
                        <TableCell>{format(new Date(expense.expense_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell>{expense.staff?.full_name}</TableCell>
                        <TableCell className="capitalize">{expense.category?.replace('_', ' ')}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{expense.description}</TableCell>
                        <TableCell className="text-right">
                          <Amount value={expense.amount} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {reportData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No reimbursed expenses found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payment" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment Register</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{format(new Date(entry.entry_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="font-mono text-xs">{entry.voucher_no}</TableCell>
                        <TableCell>{entry.staff?.full_name}</TableCell>
                        <TableCell className="capitalize">{entry.voucher_type}</TableCell>
                        <TableCell className="capitalize">{entry.payment_mode?.replace('_', ' ') || '-'}</TableCell>
                        <TableCell className="text-right">
                          <Amount value={entry.credit || entry.debit} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {reportData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No payments found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
