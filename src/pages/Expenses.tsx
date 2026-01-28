import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/status-badge';
import { Amount } from '@/components/ui/amount';
import { Input } from '@/components/ui/input';
import { 
  Plus, 
  Receipt, 
  Search, 
  Check, 
  X, 
  CreditCard,
  Eye 
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import type { Expense, ExpenseStatus } from '@/types/database';
import { EXPENSE_CATEGORY_LABELS, EXPENSE_STATUS_LABELS } from '@/types/database';
import { ExpenseDetailsDialog } from '@/components/expenses/ExpenseDetailsDialog';
import { ApproveExpenseDialog } from '@/components/expenses/ApproveExpenseDialog';
import { RejectExpenseDialog } from '@/components/expenses/RejectExpenseDialog';
import { ReimburseExpenseDialog } from '@/components/expenses/ReimburseExpenseDialog';

export default function Expenses() {
  const { user, isOwner, isAccountant, isStaff } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showReimburseDialog, setShowReimburseDialog] = useState(false);

  useEffect(() => {
    fetchExpenses();
  }, [activeTab]);

  const fetchExpenses = async () => {
    try {
      setIsLoading(true);
      let query = supabase
        .from('expenses')
        .select(`
          *,
          staff:staff_public(*)
        `)
        .order('created_at', { ascending: false });

      // Filter by status
      if (activeTab !== 'all') {
        query = query.eq('status', activeTab as ExpenseStatus);
      }

      const { data, error } = await query;

      if (error) throw error;
      setExpenses((data || []) as unknown as Expense[]);
    } catch (error) {
      console.error('Error fetching expenses:', error);
      toast({
        title: 'Error',
        description: 'Failed to load expenses',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredExpenses = expenses.filter((expense) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    return (
      expense.description.toLowerCase().includes(searchLower) ||
      expense.staff?.full_name?.toLowerCase().includes(searchLower) ||
      EXPENSE_CATEGORY_LABELS[expense.category].toLowerCase().includes(searchLower)
    );
  });

  const handleViewDetails = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowDetailsDialog(true);
  };

  const handleApprove = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowApproveDialog(true);
  };

  const handleReject = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowRejectDialog(true);
  };

  const handleReimburse = (expense: Expense) => {
    setSelectedExpense(expense);
    setShowReimburseDialog(true);
  };

  const getStatusVariant = (status: ExpenseStatus) => {
    switch (status) {
      case 'draft': return 'secondary';
      case 'pending': return 'warning';
      case 'approved': return 'info';
      case 'rejected': return 'destructive';
      case 'reimbursed': return 'success';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track and manage expense reimbursements"
      >
        {(isStaff || isOwner) && (
          <Link to="/expenses/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Expense
            </Button>
          </Link>
        )}
      </PageHeader>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search expenses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {isStaff && <TabsTrigger value="draft">Drafts</TabsTrigger>}
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          {isAccountant && <TabsTrigger value="approved">To Reimburse</TabsTrigger>}
          <TabsTrigger value="reimbursed">Reimbursed</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredExpenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No expenses found"
              description={activeTab === 'all' 
                ? "No expenses have been recorded yet." 
                : `No ${EXPENSE_STATUS_LABELS[activeTab as ExpenseStatus] || activeTab} expenses.`}
              action={
                (isStaff || isOwner) ? (
                  <Link to="/expenses/new">
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Expense
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4">
              {filteredExpenses.map((expense) => (
                <Card key={expense.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <StatusBadge 
                            status={expense.status} 
                            variant={getStatusVariant(expense.status)}
                          >
                            {EXPENSE_STATUS_LABELS[expense.status]}
                          </StatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {EXPENSE_CATEGORY_LABELS[expense.category]}
                          </span>
                        </div>
                        <p className="font-medium truncate">{expense.description}</p>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span>{expense.staff?.full_name}</span>
                          <span>{format(new Date(expense.expense_date), 'dd MMM yyyy')}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <Amount value={expense.amount} size="lg" className="text-foreground" />
                        
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewDetails(expense)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {/* Owner can approve/reject pending expenses */}
                          {isOwner && expense.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-success hover:text-success"
                                onClick={() => handleApprove(expense)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleReject(expense)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {/* Accountant or Owner can reimburse approved expenses */}
                          {(isOwner || isAccountant) && expense.status === 'approved' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary hover:text-primary"
                              onClick={() => handleReimburse(expense)}
                            >
                              <CreditCard className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {selectedExpense && (
        <>
          <ExpenseDetailsDialog
            expense={selectedExpense}
            open={showDetailsDialog}
            onOpenChange={setShowDetailsDialog}
          />
          <ApproveExpenseDialog
            expense={selectedExpense}
            open={showApproveDialog}
            onOpenChange={setShowApproveDialog}
            onSuccess={fetchExpenses}
          />
          <RejectExpenseDialog
            expense={selectedExpense}
            open={showRejectDialog}
            onOpenChange={setShowRejectDialog}
            onSuccess={fetchExpenses}
          />
          <ReimburseExpenseDialog
            expense={selectedExpense}
            open={showReimburseDialog}
            onOpenChange={setShowReimburseDialog}
            onSuccess={fetchExpenses}
          />
        </>
      )}
    </div>
  );
}
