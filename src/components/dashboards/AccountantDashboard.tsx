import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Amount } from '@/components/ui/amount';
import {
  FileText,
  CreditCard,
  ClipboardList,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry } from '@/types/database';

export function AccountantDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    paymentsRecorded: 0,
    requestsRaised: 0,
    todayEntries: 0,
  });
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      
      // Fetch payments recorded by this user (today)
      const { data: todayPayments, error: paymentsError } = await supabase
        .from('ledger_entries')
        .select('id')
        .eq('created_by', user?.id)
        .gte('created_at', `${today}T00:00:00`);

      if (paymentsError) throw paymentsError;

      // Fetch requests raised by this user
      const { data: requests, error: requestsError } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('requested_by', user?.id)
        .eq('status', 'pending');

      if (requestsError) throw requestsError;

      // Fetch recent ledger entries
      const { data: entries, error: entriesError } = await supabase
        .from('ledger_entries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (entriesError) throw entriesError;

      setStats({
        paymentsRecorded: todayPayments?.length || 0,
        requestsRaised: requests?.length || 0,
        todayEntries: todayPayments?.length || 0,
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
        description="Record payments and manage requests"
      >
        <Link to="/requests/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Request
          </Button>
        </Link>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Today's Entries"
          value={stats.todayEntries}
          subtitle="Recorded today"
          icon={FileText}
        />
        <StatCard
          title="Pending Requests"
          value={stats.requestsRaised}
          subtitle="Awaiting approval"
          icon={ClipboardList}
        />
        <StatCard
          title="Payments"
          value={stats.paymentsRecorded}
          subtitle="This month"
          icon={CreditCard}
        />
      </div>

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
              <table className="table-ledger">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Description</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </td>
                      <td className="voucher-number">{entry.voucher_no}</td>
                      <td className="max-w-[200px] truncate">{entry.description}</td>
                      <td className="text-right">
                        {entry.debit > 0 && <Amount value={entry.debit} />}
                      </td>
                      <td className="text-right">
                        {entry.credit > 0 && <Amount value={entry.credit} />}
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
  );
}
