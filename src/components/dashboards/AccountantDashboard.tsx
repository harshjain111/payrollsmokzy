import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Amount } from '@/components/ui/amount';
import { PayoutsWidget } from './PayoutsWidget';
import {
  FileText,
  CreditCard,
  ClipboardList,
  Plus,
  ChevronRight,
  CheckCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry } from '@/types/database';

export function AccountantDashboard() {
  const { user, accountingMode } = useAuth();
  const [stats, setStats] = useState({
    todayEntries: 0,
    pendingRequests: 0,
    pendingPayouts: 0,
    reimbursedToday: 0,
  });
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
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

      // Fetch approved expenses + approved unpaid requests (pending payouts)
      const { data: approvedExpenses } = await supabase
        .from('expenses')
        .select('id')
        .eq('status', 'approved');

      const { data: approvedRequests } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('status', 'approved')
        .is('paid_at', null);

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
        pendingPayouts: (approvedExpenses?.length || 0) + (approvedRequests?.length || 0),
        reimbursedToday: reimbursed?.length || 0,
      });

      setRecentEntries(entries as LedgerEntry[] || []);
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
        description="Execute payouts for approved requests and expenses"
      >
        <div className="flex gap-2">
          <Link to="/requests/new">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              New Request
            </Button>
          </Link>
          <Link to="/payouts">
            <Button>
              <CreditCard className="mr-2 h-4 w-4" />
              Payouts
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
          subtitle="Awaiting approval"
          icon={ClipboardList}
        />
        <StatCard
          title="Pending Payouts"
          value={stats.pendingPayouts}
          subtitle="Ready to pay"
          icon={CreditCard}
          variant={stats.pendingPayouts > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Paid Today"
          value={stats.reimbursedToday}
          subtitle="Completed"
          icon={CheckCircle}
          variant="success"
        />
      </div>

      {/* Payouts Widget */}
      <PayoutsWidget variant="compact" showSalary={false} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payouts Full View */}
        <PayoutsWidget variant="full" showSalary={false} />

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
