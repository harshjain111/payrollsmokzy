import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Receipt,
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
    pendingExpenses: 0,
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

      // Fetch pending expenses count
      const { count: expenseCount } = await supabase
        .from('expenses')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

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
        pendingExpenses: expenseCount || 0,
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
          <Button className="rounded-xl shadow-lg">
            <Plus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
        </Link>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Staff"
          value={stats.activeStaff}
          subtitle={`of ${stats.totalStaff} total`}
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Monthly Payroll"
          value={`₹${stats.totalPayroll.toLocaleString('en-IN')}`}
          subtitle="Total liability"
          icon={Wallet}
          color="purple"
        />
        <StatCard
          title="Advances Outstanding"
          value={`₹${stats.advancesOutstanding.toLocaleString('en-IN')}`}
          subtitle="To be adjusted"
          icon={ArrowUpRight}
          color="orange"
        />
        <StatCard
          title="Pending Approvals"
          value={stats.pendingRequests + stats.pendingExpenses}
          subtitle={`${stats.pendingRequests} requests, ${stats.pendingExpenses} expenses`}
          icon={ClipboardList}
          color="pink"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Requests */}
        <Card className="rounded-2xl shadow-card border-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-lg font-semibold">Pending Requests</CardTitle>
              <CardDescription>Payment requests awaiting approval</CardDescription>
            </div>
            <Link to="/requests">
              <Button variant="ghost" size="sm" className="rounded-lg text-primary hover:text-primary">
                View all
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                  <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">No pending requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-semibold text-primary">
                          {request.staff?.full_name?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {request.staff?.full_name}
                        </p>
                        <p className="text-sm text-muted-foreground truncate max-w-[180px]">
                          {request.reason}
                        </p>
                      </div>
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
        <Card className="rounded-2xl shadow-card border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link to="/payments/new">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mr-3">
                  <Wallet className="h-5 w-5 text-blue-600" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Record Payment</p>
                  <p className="text-xs text-muted-foreground">Create a new payment entry</p>
                </div>
              </Button>
            </Link>
            <Link to="/settlements">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mr-3">
                  <Calculator className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Settle Salary</p>
                  <p className="text-xs text-muted-foreground">Process monthly settlements</p>
                </div>
              </Button>
            </Link>
            <Link to="/expenses">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center mr-3">
                  <Receipt className="h-5 w-5 text-orange-600" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Review Expenses</p>
                  <p className="text-xs text-muted-foreground">{stats.pendingExpenses} pending for approval</p>
                </div>
              </Button>
            </Link>
            <Link to="/reports">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center mr-3">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
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
