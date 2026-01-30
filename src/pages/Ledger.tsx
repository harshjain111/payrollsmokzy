import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileText, Download, ArrowDownRight, ArrowUpRight, Scale, Lock } from 'lucide-react';
import { format } from 'date-fns';
import type { StaffPublic } from '@/types/database';

interface JournalLineWithDetails {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  staff_id: string | null;
  created_at: string;
  running_balance?: number;
  journal_entry: {
    id: string;
    entry_date: string;
    reference_no: string;
    description: string;
    transaction_type: string;
    is_legacy: boolean;
    is_immutable: boolean;
  } | null;
  account: {
    code: string;
    name: string;
    account_type: string;
  } | null;
}

export default function Ledger() {
  const [searchParams] = useSearchParams();
  const { isOwner, isAdmin, isStaff, isCA, staffData, isAccountant, accountingMode } = useAuth();
  
  const [journalLines, setJournalLines] = useState<JournalLineWithDetails[]>([]);
  const [staffList, setStaffList] = useState<StaffPublic[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>(
    searchParams.get('staff') || 'all'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Calculate totals from journal lines (double-entry system)
  const totals = journalLines.reduce(
    (acc, line) => ({
      debit: acc.debit + Number(line.debit),
      credit: acc.credit + Number(line.credit),
    }),
    { debit: 0, credit: 0 }
  );

  // Staff balance = Credit - Debit (positive = we owe them)
  const closingBalance = totals.credit - totals.debit;

  useEffect(() => {
    fetchData();
  }, [selectedStaff, selectedMonth, staffData?.id, accountingMode]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch staff list (for filter dropdown)
      if (isOwner || isAdmin || (isAccountant && accountingMode) || isCA) {
        const { data: staffListData, error: staffError } = await supabase
          .from('staff_public')
          .select('*')
          .order('full_name');

        if (staffError) throw staffError;
        setStaffList(staffListData as StaffPublic[] || []);
      }

      // Determine staff filter
      let staffIdFilter: string | null = null;
      if (isStaff || (isAccountant && !accountingMode)) {
        if (staffData?.id) {
          staffIdFilter = staffData.id;
        } else {
          setJournalLines([]);
          setIsLoading(false);
          return;
        }
      } else if (selectedStaff !== 'all') {
        staffIdFilter = selectedStaff;
      }

      // Fetch from journal_lines table (double-entry system)
      let query = supabase
        .from('journal_lines')
        .select(`
          id,
          debit,
          credit,
          description,
          staff_id,
          created_at,
          journal_entry:journal_entry_id(
            id,
            entry_date,
            reference_no,
            description,
            transaction_type,
            is_legacy,
            is_immutable
          ),
          account:account_id(
            code,
            name,
            account_type
          )
        `)
        .order('created_at', { ascending: true });

      if (staffIdFilter) {
        query = query.eq('staff_id', staffIdFilter);
      }

      const { data: linesData, error: linesError } = await query;

      if (linesError) throw linesError;

      // Calculate running balance for staff-specific lines
      let runningBalance = 0;
      const linesWithBalance = (linesData || []).map(line => {
        runningBalance += Number(line.credit) - Number(line.debit);
        return { ...line, running_balance: runningBalance };
      }) as JournalLineWithDetails[];

      setJournalLines(linesWithBalance);
    } catch (error) {
      console.error('Error fetching ledger data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate month options
  const generateMonthOptions = () => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy'),
      });
    }
    return months;
  };

  const canFilterByStaff = isOwner || isAdmin || (isAccountant && accountingMode) || isCA;
  const selectedStaffName = staffList.find(s => s.id === selectedStaff)?.full_name;

  // Transaction type display labels
  const getTransactionTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'salary_settlement': 'Salary Accrual',
      'salary_payout': 'Salary Payment',
      'expense_approval': 'Expense Approved',
      'expense_payout': 'Expense Reimbursed',
      'advance_paid': 'Advance Given',
      'advance_adjustment': 'Advance Adjusted',
    };
    return labels[type] || type;
  };

  const getTransactionTypeBadgeVariant = (type: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
    if (type.includes('payout') || type.includes('paid')) return 'default';
    if (type.includes('settlement') || type.includes('approval')) return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-6">
      <PageHeader
        title="Ledger"
        description={
          isStaff || (isAccountant && !accountingMode)
            ? "Your personal ledger"
            : selectedStaff !== 'all'
            ? `Ledger for ${selectedStaffName}`
            : "Staff-wise ledger entries"
        }
      >
        <Button variant="outline" className="rounded-xl text-xs sm:text-sm px-2 sm:px-4">
          <Download className="mr-1 sm:mr-2 h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="rounded-2xl shadow-card border-0">
        <CardContent className="pt-4 sm:pt-6 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            {canFilterByStaff && (
              <div className="w-full sm:w-64">
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger className="rounded-xl text-sm">
                    <SelectValue placeholder="Select staff" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl bg-popover">
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id || ''}>
                        {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-full sm:w-48">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="rounded-xl text-sm">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent className="rounded-xl bg-popover">
                  <SelectItem value="all">All Months</SelectItem>
                  {generateMonthOptions().map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards - Mobile Optimized */}
      <div className="grid gap-2 sm:gap-5 grid-cols-3">
        <Card className="rounded-xl sm:rounded-2xl shadow-card border-0 overflow-hidden">
          <CardContent className="p-2 sm:p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-1 sm:gap-2 mb-1">
                <div className="p-1 sm:p-2 rounded-lg bg-warning/10">
                  <ArrowDownRight className="h-3 w-3 sm:h-5 sm:w-5 text-warning" />
                </div>
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Debits</span>
              <span className="text-sm sm:text-xl font-bold font-mono truncate">
                ₹{totals.debit.toLocaleString('en-IN')}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-xl sm:rounded-2xl shadow-card border-0 overflow-hidden">
          <CardContent className="p-2 sm:p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-1 sm:gap-2 mb-1">
                <div className="p-1 sm:p-2 rounded-lg bg-success/10">
                  <ArrowUpRight className="h-3 w-3 sm:h-5 sm:w-5 text-success" />
                </div>
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Credits</span>
              <span className="text-sm sm:text-xl font-bold font-mono truncate">
                ₹{totals.credit.toLocaleString('en-IN')}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card className="rounded-xl sm:rounded-2xl shadow-card border-0 overflow-hidden">
          <CardContent className="p-2 sm:p-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-1 sm:gap-2 mb-1">
                <div className={`p-1 sm:p-2 rounded-lg ${closingBalance >= 0 ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                  <Scale className={`h-3 w-3 sm:h-5 sm:w-5 ${closingBalance >= 0 ? 'text-primary' : 'text-destructive'}`} />
                </div>
              </div>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Balance</span>
              <span className={`text-sm sm:text-xl font-bold font-mono truncate ${closingBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
                ₹{Math.abs(closingBalance).toLocaleString('en-IN')}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Balance Explanation */}
      <div className="px-1 text-xs text-muted-foreground">
        {closingBalance > 0 ? (
          <span className="text-success">↑ Company owes staff ₹{closingBalance.toLocaleString('en-IN')}</span>
        ) : closingBalance < 0 ? (
          <span className="text-warning">↓ Staff owes company ₹{Math.abs(closingBalance).toLocaleString('en-IN')}</span>
        ) : (
          <span className="text-success">✓ Ledger balanced - no outstanding</span>
        )}
      </div>

      {/* Ledger Table */}
      <Card className="rounded-2xl shadow-card border-0 overflow-hidden">
        <CardContent className="p-0">
          {journalLines.length === 0 && !isLoading ? (
            <EmptyState
              icon={FileText}
              title="No entries found"
              description="Ledger entries will appear here once transactions are recorded"
            />
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="block lg:hidden divide-y">
                {journalLines.map((line) => (
                  <div key={line.id} className="p-3 sm:p-4 space-y-1.5 sm:space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                          <Badge 
                            variant={getTransactionTypeBadgeVariant(line.journal_entry?.transaction_type || '')}
                            className="text-[10px] sm:text-xs"
                          >
                            {getTransactionTypeLabel(line.journal_entry?.transaction_type || '')}
                          </Badge>
                          {line.journal_entry?.is_immutable && (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-xs sm:text-sm line-clamp-2">
                          {line.description || line.journal_entry?.description}
                        </p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
                          {line.journal_entry?.entry_date ? format(new Date(line.journal_entry.entry_date), 'dd MMM') : '-'} • {line.journal_entry?.reference_no}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {line.account?.name}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {line.debit > 0 ? (
                          <span className="text-destructive font-medium font-mono text-xs sm:text-sm">
                            -₹{Number(line.debit).toLocaleString('en-IN')}
                          </span>
                        ) : line.credit > 0 ? (
                          <span className="text-success font-medium font-mono text-xs sm:text-sm">
                            +₹{Number(line.credit).toLocaleString('en-IN')}
                          </span>
                        ) : null}
                        <p className={`text-[10px] sm:text-xs font-mono mt-0.5 ${
                          (line.running_balance || 0) >= 0 ? 'text-success' : 'text-destructive'
                        }`}>
                          Bal: ₹{Math.abs(line.running_balance || 0).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden lg:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="font-semibold">Date</TableHead>
                      <TableHead className="font-semibold">Reference</TableHead>
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="font-semibold">Account</TableHead>
                      <TableHead className="font-semibold max-w-[250px]">Description</TableHead>
                      <TableHead className="font-semibold text-right">Debit</TableHead>
                      <TableHead className="font-semibold text-right">Credit</TableHead>
                      <TableHead className="font-semibold text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journalLines.map((line) => (
                      <TableRow key={line.id} className="group">
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {line.journal_entry?.entry_date ? format(new Date(line.journal_entry.entry_date), 'dd MMM yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs px-2 py-1 rounded-md bg-muted/50">
                            {line.journal_entry?.reference_no || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={getTransactionTypeBadgeVariant(line.journal_entry?.transaction_type || '')}
                            className="text-xs"
                          >
                            {getTransactionTypeLabel(line.journal_entry?.transaction_type || '')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{line.account?.name}</span>
                        </TableCell>
                        <TableCell className="max-w-[250px]">
                          <span className="truncate block text-sm">
                            {line.description || line.journal_entry?.description}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.debit > 0 ? (
                            <span className="text-destructive font-medium">
                              ₹{Number(line.debit).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {line.credit > 0 ? (
                            <span className="text-success font-medium">
                              ₹{Number(line.credit).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-medium">
                          <span className={(line.running_balance || 0) >= 0 ? 'text-success' : 'text-destructive'}>
                            {(line.running_balance || 0) >= 0 ? '+' : '-'}₹{Math.abs(line.running_balance || 0).toLocaleString('en-IN')}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
