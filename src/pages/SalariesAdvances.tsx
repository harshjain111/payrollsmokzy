import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Amount } from '@/components/ui/amount';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Users, 
  Calculator, 
  FileText, 
  History, 
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  Wallet,
  TrendingUp
} from 'lucide-react';
import { format, subMonths } from 'date-fns';
import type { Staff } from '@/types/database';

interface StaffWithFinancials extends Staff {
  totalAdvanceOutstanding: number;
  lastSettlementMonth: string | null;
  isCurrentMonthSettled: boolean;
}

export default function SalariesAdvances() {
  const navigate = useNavigate();
  const { isOwner, canViewSalaries } = useAuth();
  
  const [staff, setStaff] = useState<StaffWithFinancials[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'settled'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>(format(subMonths(new Date(), 1), 'yyyy-MM'));

  useEffect(() => {
    fetchStaffWithFinancials();
  }, [selectedMonth]);

  const fetchStaffWithFinancials = async () => {
    try {
      setIsLoading(true);

      // Fetch all active staff
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('is_active', true)
        .order('full_name');

      if (staffError) throw staffError;

      // Fetch advance balances and settlement status for each staff
      const enrichedStaff = await Promise.all(
        (staffData || []).map(async (s) => {
          // Get outstanding advances
          const { data: advanceData } = await supabase
            .rpc('get_advances_outstanding', { _staff_id: s.id });

          // Get last settlement
          const { data: lastSettlement } = await supabase
            .from('salary_settlements')
            .select('settlement_month')
            .eq('staff_id', s.id)
            .eq('status', 'settled')
            .order('settlement_month', { ascending: false })
            .limit(1)
            .maybeSingle();

          // Check if current selected month is settled
          const { data: isSettled } = await supabase
            .rpc('is_salary_settled', {
              _staff_id: s.id,
              _month: selectedMonth,
            });

          return {
            ...s,
            totalAdvanceOutstanding: Number(advanceData) || 0,
            lastSettlementMonth: lastSettlement?.settlement_month || null,
            isCurrentMonthSettled: isSettled || false,
          } as StaffWithFinancials;
        })
      );

      setStaff(enrichedStaff);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
    };
  }).filter(m => m.value <= format(new Date(), 'yyyy-MM'));

  const filteredStaff = staff.filter((s) => {
    const matchesSearch = s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.employee_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.department?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);
    
    const matchesFilter = filterStatus === 'all' ||
      (filterStatus === 'settled' && s.isCurrentMonthSettled) ||
      (filterStatus === 'pending' && !s.isCurrentMonthSettled);

    return matchesSearch && matchesFilter;
  });

  const totalPendingPayouts = filteredStaff.filter(s => !s.isCurrentMonthSettled).length;
  const totalAdvancesOutstanding = staff.reduce((sum, s) => sum + s.totalAdvanceOutstanding, 0);
  const totalSettled = filteredStaff.filter(s => s.isCurrentMonthSettled).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salaries & Advances"
        description="Staff salary overview and advance management"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Settlements</p>
                <p className="text-2xl font-bold text-warning">{totalPendingPayouts}</p>
              </div>
              <Clock className="h-8 w-8 text-warning/30" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Settled This Month</p>
                <p className="text-2xl font-bold text-success">{totalSettled}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-success/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Advances Outstanding</p>
                <Amount value={totalAdvancesOutstanding} className="text-2xl font-bold" />
              </div>
              <TrendingUp className="h-8 w-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, ID, or department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((month) => (
              <SelectItem key={month.value} value={month.value}>
                {month.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as 'all' | 'pending' | 'settled')}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Staff</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Staff Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-4">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredStaff.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Users className="h-12 w-12 mb-4 opacity-50" />
            <p>No staff found matching your criteria</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStaff.map((s) => (
            <StaffTile
              key={s.id}
              staff={s}
              selectedMonth={selectedMonth}
              canViewSalaries={canViewSalaries}
              isOwner={isOwner}
              onSettleSalary={() => navigate(`/settlements?staff=${s.id}&month=${selectedMonth}`)}
              onViewLedger={() => navigate(`/ledger?staff=${s.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StaffTileProps {
  staff: StaffWithFinancials;
  selectedMonth: string;
  canViewSalaries: boolean;
  isOwner: boolean;
  onSettleSalary: () => void;
  onViewLedger: () => void;
}

function StaffTile({ 
  staff, 
  selectedMonth, 
  canViewSalaries, 
  isOwner,
  onSettleSalary, 
  onViewLedger 
}: StaffTileProps) {
  const navigate = useNavigate();
  const monthLabel = format(new Date(selectedMonth + '-01'), 'MMM yyyy');

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{staff.full_name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {staff.employee_id} • {staff.department || 'No Dept'}
            </p>
          </div>
          <Badge 
            variant={staff.isCurrentMonthSettled ? 'default' : 'secondary'}
            className={staff.isCurrentMonthSettled ? 'bg-success' : 'bg-warning text-warning-foreground'}
          >
            {staff.isCurrentMonthSettled ? 'Settled' : 'Pending'}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Salary - Owner only */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Monthly Salary</span>
          {canViewSalaries ? (
            <Amount value={staff.monthly_salary} className="font-medium" />
          ) : (
            <span className="font-mono text-muted-foreground flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              ***
            </span>
          )}
        </div>

        {/* Salary Due - Owner only */}
        {canViewSalaries && !staff.isCurrentMonthSettled && (
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Salary Due ({monthLabel})</span>
            <Amount value={staff.monthly_salary} className="font-medium text-primary" />
          </div>
        )}

        {/* Advance Outstanding - visible to all who can access this page */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Advance Outstanding</span>
          <Amount 
            value={staff.totalAdvanceOutstanding} 
            className={staff.totalAdvanceOutstanding > 0 ? 'text-warning font-medium' : 'text-muted-foreground'}
          />
        </div>

        {/* Last Settlement */}
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Last Settlement</span>
          <span className="text-sm">
            {staff.lastSettlementMonth 
              ? format(new Date(staff.lastSettlementMonth + '-01'), 'MMM yyyy')
              : 'Never'
            }
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t">
          {isOwner && !staff.isCurrentMonthSettled && (
            <Button 
              size="sm" 
              onClick={onSettleSalary}
              className="flex-1"
            >
              <Calculator className="mr-1.5 h-3.5 w-3.5" />
              Settle
            </Button>
          )}
          
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onViewLedger}
            className={isOwner && !staff.isCurrentMonthSettled ? '' : 'flex-1'}
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Ledger
          </Button>

          <Button 
            size="sm" 
            variant="ghost"
            onClick={() => navigate(`/staff/${staff.id}`)}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
