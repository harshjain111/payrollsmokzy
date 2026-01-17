import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Amount } from '@/components/ui/amount';
import {
  Users,
  Wallet,
  ArrowUpRight,
  ClipboardList,
  Calculator,
  TrendingUp,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import type { PaymentRequest, Staff } from '@/types/database';

export function OwnerDashboard() {
  const [stats, setStats] = useState({
    totalStaff: 0,
    activeStaff: 0,
    totalPayroll: 0,
    advancesOutstanding: 0,
    pendingRequests: 0,
  });
  const [pendingRequests, setPendingRequests] = useState<(PaymentRequest & { staff: Staff })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch staff stats
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('id, monthly_salary, is_active');

      if (staffError) throw staffError;

      const activeStaff = staffData?.filter(s => s.is_active) || [];
      const totalPayroll = activeStaff.reduce((sum, s) => sum + Number(s.monthly_salary), 0);

      // Fetch pending requests
      const { data: requestsData, error: requestsError } = await supabase
        .from('payment_requests')
        .select(`
          *,
          staff:staff_id (*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      if (requestsError) throw requestsError;

      // Fetch advances (total debits - credits for advance tags)
      const { data: ledgerData, error: ledgerError } = await supabase
        .from('ledger_entries')
        .select('debit, credit, tag')
        .eq('tag', 'advance');

      if (ledgerError) throw ledgerError;

      const advances = ledgerData?.reduce((sum, entry) => {
        return sum + Number(entry.debit) - Number(entry.credit);
      }, 0) || 0;

      setStats({
        totalStaff: staffData?.length || 0,
        activeStaff: activeStaff.length,
        totalPayroll,
        advancesOutstanding: advances,
        pendingRequests: requestsData?.length || 0,
      });

      setPendingRequests(requestsData as any || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const currentMonth = format(new Date(), 'MMMM yyyy');

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`Overview for ${currentMonth}`}
      >
        <Link to="/staff/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
        </Link>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Staff"
          value={stats.activeStaff}
          subtitle={`of ${stats.totalStaff} total`}
          icon={Users}
        />
        <StatCard
          title="Monthly Payroll"
          value={`₹${stats.totalPayroll.toLocaleString('en-IN')}`}
          subtitle="Total liability"
          icon={Wallet}
          variant="primary"
        />
        <StatCard
          title="Advances Outstanding"
          value={`₹${stats.advancesOutstanding.toLocaleString('en-IN')}`}
          subtitle="To be adjusted"
          icon={ArrowUpRight}
          variant={stats.advancesOutstanding > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Pending Requests"
          value={stats.pendingRequests}
          subtitle="Awaiting approval"
          icon={ClipboardList}
          variant={stats.pendingRequests > 0 ? 'destructive' : 'success'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Pending Requests</CardTitle>
              <CardDescription>Payment requests awaiting approval</CardDescription>
            </div>
            <Link to="/requests">
              <Button variant="ghost" size="sm">
                View all
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                No pending requests
              </p>
            ) : (
              <div className="space-y-4">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-secondary/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {request.staff?.full_name}
                      </p>
                      <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {request.reason}
                      </p>
                    </div>
                    <div className="text-right">
                      <Amount value={request.amount} size="md" />
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(request.created_at), 'dd MMM')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link to="/payments/new">
              <Button variant="outline" className="w-full justify-start h-auto py-4">
                <Wallet className="mr-3 h-5 w-5 text-primary" />
                <div className="text-left">
                  <p className="font-medium">Record Payment</p>
                  <p className="text-xs text-muted-foreground">Create a new payment entry</p>
                </div>
              </Button>
            </Link>
            <Link to="/settlements">
              <Button variant="outline" className="w-full justify-start h-auto py-4">
                <Calculator className="mr-3 h-5 w-5 text-success" />
                <div className="text-left">
                  <p className="font-medium">Settle Salary</p>
                  <p className="text-xs text-muted-foreground">Process monthly settlements</p>
                </div>
              </Button>
            </Link>
            <Link to="/reports">
              <Button variant="outline" className="w-full justify-start h-auto py-4">
                <TrendingUp className="mr-3 h-5 w-5 text-info" />
                <div className="text-left">
                  <p className="font-medium">View Reports</p>
                  <p className="text-xs text-muted-foreground">Generate payroll reports</p>
                </div>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
