import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Amount } from '@/components/ui/amount';
import { ApprovalsWidget } from './ApprovalsWidget';
import { PayoutsWidget } from './PayoutsWidget';
import {
  Users,
  Wallet,
  ArrowUpRight,
  Calculator,
  TrendingUp,
  Plus,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { format } from 'date-fns';

export function OwnerDashboard() {
  const [stats, setStats] = useState({
    totalStaff: 0,
    activeStaff: 0,
    totalPayroll: 0,
    advancesOutstanding: 0,
  });
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
          title="Monthly Target"
          value={format(new Date(), 'MMM yyyy')}
          subtitle="Current period"
          icon={Calculator}
          color="pink"
        />
      </div>

      {/* Action Widgets - Clickable with Details */}
      <div className="grid gap-5 md:grid-cols-2">
        <ApprovalsWidget variant="compact" />
        <PayoutsWidget variant="compact" showSalary />
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
            <Link to="/payouts">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mr-3">
                  <Wallet className="h-5 w-5 text-primary" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Execute Payouts</p>
                  <p className="text-xs text-muted-foreground">Pay approved requests & expenses</p>
                </div>
              </Button>
            </Link>
            <Link to="/settlements">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center mr-3">
                  <Calculator className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium">Settle Salary</p>
                  <p className="text-xs text-muted-foreground">Process monthly settlements</p>
                </div>
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
            <Link to="/reports">
              <Button variant="outline" className="w-full justify-start h-auto py-4 rounded-xl border-border/50 hover:bg-primary/5 hover:border-primary/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mr-3">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
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
