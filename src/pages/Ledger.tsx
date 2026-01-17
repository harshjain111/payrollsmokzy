import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Amount } from '@/components/ui/amount';
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
import { FileText, Download, Filter } from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry, Staff, StaffPublic } from '@/types/database';

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
    <div>
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
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {canFilterByStaff && (
              <div className="w-full sm:w-64">
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-full sm:w-48">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
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
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Debits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Amount value={totals.debit} size="lg" className="text-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Credits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Amount value={totals.credit} size="lg" className="text-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Closing Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Amount value={closingBalance} size="lg" showSign />
          </CardContent>
        </Card>
      </div>

      {/* Ledger Table */}
      <Card>
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
                  <TableRow className="bg-secondary/50">
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="max-w-[300px]">Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="voucher-number">
                        {entry.voucher_no}
                      </TableCell>
                      <TableCell>
                        <span className="capitalize text-sm">
                          {entry.voucher_type}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {entry.description}
                        {entry.tag && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            [{entry.tag}]
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.debit > 0 ? (
                          <Amount value={entry.debit} className="text-destructive" />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.credit > 0 ? (
                          <Amount value={entry.credit} className="text-success" />
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <Amount value={entry.running_balance} showSign />
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
