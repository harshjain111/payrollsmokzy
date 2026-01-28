import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Amount } from '@/components/ui/amount';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  FileText,
  CreditCard,
  ClipboardList,
  Plus,
  ChevronRight,
  Receipt,
  CheckCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry, Expense } from '@/types/database';

export function AccountantDashboard() {
  const { user, accountingMode } = useAuth();
  const [stats, setStats] = useState({
    todayEntries: 0,
    pendingRequests: 0,
    approvedExpenses: 0,
    reimbursedToday: 0,
  });
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
  const [approvedExpenses, setApprovedExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, [accountingMode]);

  const fetchDashboardData = async () => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      
      // Fetch entries recorded today by this user
      const { data: todayPayments, error: paymentsError } = await supabase
        .from('ledger_entries')
        .select('id')
        .eq('created_by', user?.id)
        .gte('created_at', `${today}T00:00:00`);

      if (paymentsError) throw paymentsError;

      // Fetch pending requests (view only for accountant)
      const { data: requests, error: requestsError } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('status', 'pending');

      if (requestsError) throw requestsError;

      // Fetch approved expenses (accountant can reimburse these)
      const { data: approved, error: approvedError } = await supabase
        .from('expenses')
        .select('*, staff:staff_public(full_name, employee_id)')
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(5);

      if (approvedError) throw approvedError;

      // Fetch reimbursed expenses today
      const { data: reimbursed, error: reimbursedError } = await supabase
        .from('expenses')
        .select('id')
        .eq('status', 'reimbursed')
        .eq('reimbursed_by', user?.id)
        .gte('reimbursed_at', `${today}T00:00:00`);

      if (reimbursedError) throw reimbursedError;

      // Fetch recent ledger entries (non-salary only for accountant)
      const { data: entries, error: entriesError } = await supabase
        .from('ledger_entries')
        .select('*')
        .not('voucher_type', 'eq', 'settlement') // Exclude salary settlements
        .order('created_at', { ascending: false })
        .limit(10);

      if (entriesError) throw entriesError;

      setStats({
        todayEntries: todayPayments?.length || 0,
        pendingRequests: requests?.length || 0,
        approvedExpenses: approved?.length || 0,
        reimbursedToday: reimbursed?.length || 0,
      });

      setRecentEntries(entries as LedgerEntry[] || []);
      setApprovedExpenses(approved as Expense[] || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Accounting Dashboard"
        description="Record payments and manage expense reimbursements"
      >
        <div className="flex gap-2">
          <Link to="/expenses/new">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              New Expense
            </Button>
          </Link>
          <Link to="/payments/new">
            <Button>
              <CreditCard className="mr-2 h-4 w-4" />
              Record Payment
            </Button>
          </Link>
        </div>
      </PageHeader>

      {/* Stats - Non-salary metrics only */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Today's Entries"
          value={stats.todayEntries}
          subtitle="Recorded today"
          icon={FileText}
        />
        <StatCard
          title="Pending Requests"
          value={stats.pendingRequests}
          subtitle="Awaiting approval (view only)"
          icon={ClipboardList}
        />
        <StatCard
          title="Approved Expenses"
          value={stats.approvedExpenses}
          subtitle="Ready to reimburse"
          icon={Receipt}
          variant={stats.approvedExpenses > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Reimbursed Today"
          value={stats.reimbursedToday}
          subtitle="Expenses paid"
          icon={CheckCircle}
          variant="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Approved Expenses - Ready to Reimburse */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Ready to Reimburse</CardTitle>
              <CardDescription>Approved expenses awaiting payment</CardDescription>
            </div>
            <Link to="/expenses">
              <Button variant="ghost" size="sm">
                View all
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {approvedExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-10 w-10 text-success/50 mb-3" />
                <p className="text-muted-foreground">All caught up!</p>
                <p className="text-sm text-muted-foreground">No pending reimbursements</p>
              </div>
            ) : (
              <div className="space-y-3">
                {approvedExpenses.map((expense: any) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-secondary/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-sm">{expense.staff?.full_name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {expense.category?.replace('_', ' ')} • {expense.description?.slice(0, 30)}...
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <Amount value={expense.amount} size="sm" />
                      <Link to="/payments/new">
                        <Button size="sm" variant="outline">
                          Reimburse
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Entries */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Recent Ledger Entries</CardTitle>
              <CardDescription>Latest financial transactions</CardDescription>
            </div>
            <Link to="/ledger">
              <Button variant="ghost" size="sm">
                View all
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                No entries yet
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Voucher</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEntries.slice(0, 5).map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0">
                        <td className="py-2 whitespace-nowrap">
                          {format(new Date(entry.entry_date), 'dd MMM')}
                        </td>
                        <td className="py-2 font-mono text-xs">{entry.voucher_no}</td>
                        <td className="py-2 capitalize">{entry.voucher_type}</td>
                        <td className="py-2 text-right">
                          {entry.credit > 0 ? (
                            <Amount value={entry.credit} className="text-success" />
                          ) : (
                            <Amount value={entry.debit} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
