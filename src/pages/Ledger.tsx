import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/ui/amount';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { FileText, Download, ArrowDownRight, ArrowUpRight, Scale, Lock, History } from 'lucide-react';
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

interface LegacyLedgerEntry {
  id: string;
  entry_date: string;
  voucher_no: string;
  voucher_type: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  tag: string | null;
  is_legacy: boolean;
  is_immutable: boolean;
}

export default function Ledger() {
  const [searchParams] = useSearchParams();
  const { isOwner, isAdmin, isStaff, isCA, staffData, isAccountant, accountingMode, canViewSalaries } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'current' | 'legacy'>('current');
  const [journalLines, setJournalLines] = useState<JournalLineWithDetails[]>([]);
  const [legacyEntries, setLegacyEntries] = useState<LegacyLedgerEntry[]>([]);
  const [staffList, setStaffList] = useState<StaffPublic[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>(
    searchParams.get('staff') || 'all'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [hasLegacyData, setHasLegacyData] = useState(false);

  // Calculate totals from journal lines (new double-entry system)
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
  }, [selectedStaff, selectedMonth, staffData?.id, accountingMode, activeTab]);

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
          setLegacyEntries([]);
          setIsLoading(false);
          return;
        }
      } else if (selectedStaff !== 'all') {
        staffIdFilter = selectedStaff;
      }

      if (activeTab === 'current') {
        // Fetch from new journal_lines table (double-entry)
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

        // Check if there's legacy data
        const { count } = await supabase
          .from('ledger_entries')
          .select('*', { count: 'exact', head: true })
          .eq('is_legacy', true);
        
        setHasLegacyData((count || 0) > 0);

      } else {
        // Fetch legacy ledger entries
        let query = supabase
          .from('ledger_entries')
          .select('*')
          .eq('is_legacy', true)
          .order('entry_date', { ascending: true })
          .order('created_at', { ascending: true });

        if (staffIdFilter) {
          query = query.eq('staff_id', staffIdFilter);
        }

        if (selectedMonth !== 'all') {
          query = query.eq('reference_month', selectedMonth);
        }

        const { data: legacyData, error: legacyError } = await query;

        if (legacyError) throw legacyError;

        // Calculate running balance
        let runningBalance = 0;
        const entriesWithBalance = (legacyData || []).map(entry => {
          runningBalance += Number(entry.credit) - Number(entry.debit);
          return { ...entry, running_balance: runningBalance };
        }) as LegacyLedgerEntry[];

        setLegacyEntries(entriesWithBalance);
      }
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

      {/* Summary Cards */}
      <div className="grid gap-3 sm:gap-5 grid-cols-3">
        <StatCard
          title="Debits"
          value={`₹${totals.debit.toLocaleString('en-IN')}`}
          icon={ArrowDownRight}
          color="orange"
        />
        <StatCard
          title="Credits"
          value={`₹${totals.credit.toLocaleString('en-IN')}`}
          icon={ArrowUpRight}
          color="green"
        />
        <StatCard
          title="Balance"
          value={`${closingBalance >= 0 ? '+' : ''}₹${Math.abs(closingBalance).toLocaleString('en-IN')}`}
          icon={Scale}
          color={closingBalance >= 0 ? 'blue' : 'pink'}
        />
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

      {/* Tabs for Current vs Legacy */}
      {hasLegacyData && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'current' | 'legacy')}>
          <TabsList>
            <TabsTrigger value="current">
              Current (Double-Entry)
            </TabsTrigger>
            <TabsTrigger value="legacy">
              <History className="h-4 w-4 mr-1" />
              Legacy
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Ledger Table */}
      <Card className="rounded-2xl shadow-card border-0 overflow-hidden">
        <CardContent className="p-0">
          {activeTab === 'current' ? (
            journalLines.length === 0 && !isLoading ? (
              <EmptyState
                icon={FileText}
                title="No entries found"
                description="Ledger entries will appear here once transactions are recorded using the new double-entry system"
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
                            Bal: {(line.running_balance || 0) >= 0 ? '+' : ''}₹{Math.abs(line.running_balance || 0).toLocaleString('en-IN')}
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
                            <span className="text-xs text-muted-foreground block">{line.account?.code}</span>
                          </TableCell>
                          <TableCell className="max-w-[250px]">
                            <span className="truncate block">{line.description || line.journal_entry?.description}</span>
                            {line.journal_entry?.is_immutable && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                <Lock className="h-3 w-3" />
                                Immutable
                              </span>
                            )}
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
            )
          ) : (
            // Legacy Entries View
            legacyEntries.length === 0 && !isLoading ? (
              <EmptyState
                icon={History}
                title="No legacy entries"
                description="Legacy entries from the old single-entry system will appear here"
              />
            ) : (
              <div className="hidden lg:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="font-semibold">Date</TableHead>
                      <TableHead className="font-semibold">Voucher</TableHead>
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="font-semibold max-w-[300px]">Description</TableHead>
                      <TableHead className="font-semibold text-right">Debit</TableHead>
                      <TableHead className="font-semibold text-right">Credit</TableHead>
                      <TableHead className="font-semibold text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {legacyEntries.map((entry) => (
                      <TableRow key={entry.id} className="group opacity-75">
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs px-2 py-1 rounded-md bg-muted/50">
                            {entry.voucher_no}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {entry.voucher_type} (legacy)
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px]">
                          <span className="truncate block">{entry.description}</span>
                          {entry.tag && (
                            <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded mt-1 inline-block">
                              {entry.tag}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {entry.debit > 0 ? (
                            <span className="text-destructive font-medium">
                              ₹{Number(entry.debit).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {entry.credit > 0 ? (
                            <span className="text-success font-medium">
                              ₹{Number(entry.credit).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-medium">
                          <span className={entry.running_balance >= 0 ? 'text-success' : 'text-destructive'}>
                            {entry.running_balance >= 0 ? '+' : '-'}₹{Math.abs(entry.running_balance).toLocaleString('en-IN')}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
