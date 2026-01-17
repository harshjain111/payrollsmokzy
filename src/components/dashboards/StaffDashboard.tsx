import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Amount } from '@/components/ui/amount';
import {
  Wallet,
  ArrowUpRight,
  ClipboardList,
  Plus,
  ChevronRight,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import type { LedgerEntry, PaymentRequest } from '@/types/database';

export function StaffDashboard() {
  const { staffData } = useAuth();
  const [balance, setBalance] = useState(0);
  const [advances, setAdvances] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
  const [myRequests, setMyRequests] = useState<PaymentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (staffData?.id) {
      fetchDashboardData();
    }
  }, [staffData?.id]);

  const fetchDashboardData = async () => {
    if (!staffData?.id) return;

    try {
      // Fetch ledger entries for balance calculation
      const { data: ledgerData, error: ledgerError } = await supabase
        .from('ledger_entries')
        .select('*')
        .eq('staff_id', staffData.id)
        .order('entry_date', { ascending: false });

      if (ledgerError) throw ledgerError;

      // Calculate balance and advances
      let totalDebits = 0;
      let totalCredits = 0;
      let totalAdvances = 0;

      (ledgerData || []).forEach(entry => {
        totalDebits += Number(entry.debit);
        totalCredits += Number(entry.credit);
        if (entry.tag === 'advance') {
          totalAdvances += Number(entry.debit) - Number(entry.credit);
        }
      });

      setBalance(totalCredits - totalDebits);
      setAdvances(totalAdvances);
      setRecentEntries((ledgerData || []).slice(0, 5) as LedgerEntry[]);

      // Fetch payment requests
      const { data: requestsData, error: requestsError } = await supabase
        .from('payment_requests')
        .select('*')
        .eq('staff_id', staffData.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (requestsError) throw requestsError;

      const pending = (requestsData || []).filter(r => r.status === 'pending');
      setPendingRequests(pending.length);
      setMyRequests(requestsData as PaymentRequest[] || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!staffData) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl font-semibold text-foreground">Profile Not Found</h2>
        <p className="text-muted-foreground mt-2">
          Please contact your administrator to set up your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${staffData.full_name.split(' ')[0]}`}
        description="Your salary and payment overview"
      >
        <Link to="/requests/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Request Payment
          </Button>
        </Link>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Monthly Salary"
          value={`₹${staffData.monthly_salary.toLocaleString('en-IN')}`}
          subtitle="Fixed salary"
          icon={Wallet}
          variant="primary"
        />
        <StatCard
          title="Advances"
          value={`₹${advances.toLocaleString('en-IN')}`}
          subtitle="To be adjusted"
          icon={ArrowUpRight}
          variant={advances > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Pending Requests"
          value={pendingRequests}
          subtitle="Awaiting approval"
          icon={ClipboardList}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Ledger */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Recent Transactions</CardTitle>
              <CardDescription>Your latest ledger entries</CardDescription>
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
                No transactions yet
              </p>
            ) : (
              <div className="space-y-3">
                {recentEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium text-sm">{entry.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <div className="text-right">
                      {entry.credit > 0 ? (
                        <Amount value={entry.credit} className="text-success" />
                      ) : (
                        <Amount value={-entry.debit} className="text-destructive" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* My Requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">My Requests</CardTitle>
              <CardDescription>Payment request status</CardDescription>
            </div>
            <Link to="/requests">
              <Button variant="ghost" size="sm">
                View all
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {myRequests.length === 0 ? (
              <div className="text-center py-8">
                <CreditCard className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">No requests yet</p>
                <Link to="/requests/new">
                  <Button variant="link" size="sm" className="mt-2">
                    Create your first request
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {myRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium text-sm truncate max-w-[180px]">
                        {request.reason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(request.created_at), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <Amount value={request.amount} size="sm" />
                      <StatusBadge status={request.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
