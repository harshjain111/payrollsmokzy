import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApprovalsWidget } from './ApprovalsWidget';
import { PayoutsWidget } from './PayoutsWidget';
import {
  Users,
  ClipboardList,
  CreditCard,
  Plus,
  Receipt,
  UserPlus,
  TrendingUp,
  ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';

export function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    activeStaff: 0,
    pendingApprovals: 0,
    pendingPayouts: 0,
    todayActions: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch active staff count
      const { data: staffData } = await supabase
        .from('staff')
        .select('id')
        .eq('is_active', true);

      // Fetch pending requests
      const { data: pendingRequests } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('status', 'pending');

      // Fetch pending expenses
      const { data: pendingExpenses } = await supabase
        .from('expenses')
        .select('id')
        .eq('status', 'pending');

      // Fetch approved items ready for payout
      const { data: approvedExpenses } = await supabase
        .from('expenses')
        .select('id')
        .eq('status', 'approved');

      const { data: approvedRequests } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('status', 'approved')
        .is('paid_at', null);

      // Fetch today's actions by this user
      const today = format(new Date(), 'yyyy-MM-dd');
      const { data: todayEntries } = await supabase
        .from('ledger_entries')
        .select('id')
        .eq('created_by', user?.id)
        .gte('created_at', `${today}T00:00:00`);

      setStats({
        activeStaff: staffData?.length || 0,
        pendingApprovals: (pendingRequests?.length || 0) + (pendingExpenses?.length || 0),
        pendingPayouts: (approvedExpenses?.length || 0) + (approvedRequests?.length || 0),
        todayActions: todayEntries?.length || 0,
      });
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
        title="Admin Dashboard"
        description={`Overview for ${currentMonth}`}
      >
        <Link to="/staff/new">
          <Button className="rounded-xl shadow-lg">
            <UserPlus className="mr-2 h-4 w-4" />
            Add Staff
          </Button>
        </Link>
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Staff"
          value={stats.activeStaff}
          subtitle="Total employees"
          icon={Users}
          color="blue"
        />
        <StatCard
          title="Pending Approvals"
          value={stats.pendingApprovals}
          subtitle="Need your action"
          icon={ClipboardList}
          color="orange"
          variant={stats.pendingApprovals > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Pending Payouts"
          value={stats.pendingPayouts}
          subtitle="Ready to pay"
          icon={CreditCard}
          color="purple"
        />
        <StatCard
          title="Today's Actions"
          value={stats.todayActions}
          subtitle="Entries recorded"
          icon={TrendingUp}
          color="pink"
        />
      </div>

      {/* Action Widgets - Clickable with Details */}
      <div className="grid gap-5 md:grid-cols-2">
        <ApprovalsWidget variant="compact" />
        <PayoutsWidget variant="compact" showSalary={false} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Approvals Card (Full View) */}
        <ApprovalsWidget variant="full" />

        {/* Quick Actions */}
        <Card className="rounded-2xl shadow-card border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Link to="/requests">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mr-3">
                  <ClipboardList className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-medium">Review Requests</p>
                  <p className="text-xs text-muted-foreground">Approve or reject pending requests</p>
                </div>
                {stats.pendingApprovals > 0 && (
                  <span className="bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded-full">
                    {stats.pendingApprovals}
                  </span>
                )}
              </Button>
            </Link>
            <Link to="/payouts">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center mr-3">
                  <CreditCard className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div className="text-left flex-1">
                  <p className="font-medium">Execute Payouts</p>
                  <p className="text-xs text-muted-foreground">Pay approved requests & expenses</p>
                </div>
                {stats.pendingPayouts > 0 && (
                  <span className="bg-primary/20 text-primary text-xs px-2 py-1 rounded-full">
                    {stats.pendingPayouts}
                  </span>
                )}
              </Button>
            </Link>
            <Link to="/expenses">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-accent/50 flex items-center justify-center mr-3">
                  <Receipt className="h-5 w-5 text-accent-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Review Expenses</p>
                  <p className="text-xs text-muted-foreground">Approve pending expense claims</p>
                </div>
              </Button>
            </Link>
            <Link to="/staff">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mr-3">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Manage Staff</p>
                  <p className="text-xs text-muted-foreground">View and manage employee records</p>
                </div>
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
