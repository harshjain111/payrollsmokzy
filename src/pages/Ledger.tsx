import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/ui/amount';
import { StatCard } from '@/components/ui/stat-card';
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
import { FileText, Download, ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry, StaffPublic } from '@/types/database';

export default function Ledger() {
  const [searchParams] = useSearchParams();
  const { isOwner, isStaff, isCA, staffData, isAccountant, accountingMode } = useAuth();
  
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [staffList, setStaffList] = useState<StaffPublic[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>(
    searchParams.get('staff') || 'all'
  );
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Calculate totals
  const totals = entries.reduce(
    (acc, entry) => ({
      debit: acc.debit + Number(entry.debit),
      credit: acc.credit + Number(entry.credit),
    }),
    { debit: 0, credit: 0 }
  );

  const closingBalance = totals.credit - totals.debit;

  useEffect(() => {
    fetchData();
  }, [selectedStaff, selectedMonth, staffData?.id]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch staff list (for filter dropdown)
      if (isOwner || (isAccountant && accountingMode) || isCA) {
        const { data: staffData, error: staffError } = await supabase
          .from('staff_public')
          .select('*')
          .order('full_name');

        if (staffError) throw staffError;
        setStaffList(staffData as StaffPublic[] || []);
      }

      // Build ledger query
      let query = supabase
        .from('ledger_entries')
        .select('*')
        .order('entry_date', { ascending: true })
        .order('created_at', { ascending: true });

      // Filter by staff
      if (isStaff || (isAccountant && !accountingMode)) {
        // Staff can only see their own
        if (staffData?.id) {
          query = query.eq('staff_id', staffData.id);
        }
      } else if (selectedStaff !== 'all') {
        query = query.eq('staff_id', selectedStaff);
      }

      // Filter by month
      if (selectedMonth !== 'all') {
        query = query.eq('reference_month', selectedMonth);
      }

      const { data: ledgerData, error: ledgerError } = await query;

      if (ledgerError) throw ledgerError;

      // Calculate running balance
      let runningBalance = 0;
      const entriesWithBalance = (ledgerData || []).map(entry => {
        runningBalance += Number(entry.credit) - Number(entry.debit);
        return { ...entry, running_balance: runningBalance };
      });

      setEntries(entriesWithBalance as LedgerEntry[]);
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

  const canFilterByStaff = isOwner || (isAccountant && accountingMode) || isCA;
  const selectedStaffName = staffList.find(s => s.id === selectedStaff)?.full_name;

  return (
    <div className="space-y-6">
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
        <Button variant="outline" className="rounded-xl">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="rounded-2xl shadow-card border-0">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {canFilterByStaff && (
              <div className="w-full sm:w-64">
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select staff" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
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
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
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
      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          title="Total Debits"
          value={`₹${totals.debit.toLocaleString('en-IN')}`}
          icon={ArrowDownRight}
          color="orange"
        />
        <StatCard
          title="Total Credits"
          value={`₹${totals.credit.toLocaleString('en-IN')}`}
          icon={ArrowUpRight}
          color="green"
        />
        <StatCard
          title="Closing Balance"
          value={`${closingBalance >= 0 ? '+' : ''}₹${Math.abs(closingBalance).toLocaleString('en-IN')}`}
          icon={Scale}
          color={closingBalance >= 0 ? 'blue' : 'pink'}
        />
      </div>

      {/* Ledger Table */}
      <Card className="rounded-2xl shadow-card border-0 overflow-hidden">
        <CardContent className="p-0">
          {entries.length === 0 && !isLoading ? (
            <EmptyState
              icon={FileText}
              title="No entries found"
              description="Ledger entries will appear here once transactions are recorded"
            />
          ) : (
            <div className="overflow-x-auto">
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
                  {entries.map((entry, index) => (
                    <TableRow key={entry.id} className="group">
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs px-2 py-1 rounded-md bg-muted/50">
                          {entry.voucher_no}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/5 text-primary capitalize">
                          {entry.voucher_type}
                        </span>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
