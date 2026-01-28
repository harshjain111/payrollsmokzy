import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Amount } from '@/components/ui/amount';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ClipboardList, Check, X, Loader2, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { PaymentRequest, StaffPublic } from '@/types/database';

interface RequestWithStaff extends PaymentRequest {
  staff: StaffPublic;
}

export default function Requests() {
  const { 
    isOwner, 
    isAdmin, 
    isStaff, 
    staffData, 
    user, 
    isAccountant, 
    accountingMode,
    canApproveRequests 
  } = useAuth();
  
  const [requests, setRequests] = useState<RequestWithStaff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithStaff | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');

  useEffect(() => {
    fetchRequests();
  }, [staffData?.id, activeTab]);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('payment_requests')
        .select(`
          *,
          staff:staff_id (
            id, user_id, employee_id, full_name, email, phone, 
            department, designation, date_of_joining, is_active, 
            created_at, updated_at
          )
        `)
        .order('created_at', { ascending: false });

      // Staff can only see their own requests
      // Accountant in personal mode sees own requests only
      if (isStaff || (isAccountant && !accountingMode)) {
        if (staffData?.id) {
          query = query.eq('staff_id', staffData.id);
        }
      }

      // Filter by status
      if (activeTab !== 'all' && (activeTab === 'pending' || activeTab === 'approved' || activeTab === 'rejected')) {
        query = query.eq('status', activeTab);
      }

      const { data, error } = await query;

      if (error) throw error;
      setRequests(data as RequestWithStaff[] || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (request: RequestWithStaff) => {
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('payment_requests')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', request.id);

      if (error) throw error;

      // Notify the staff member
      if (request.staff?.user_id) {
        await supabase.rpc('create_notification', {
          _user_id: request.staff.user_id,
          _title: 'Request Approved',
          _message: `Your payment request of ₹${request.amount.toLocaleString('en-IN')} has been approved and is ready for payout.`,
          _type: 'success',
          _reference_type: 'payment_request',
          _reference_id: request.id,
        });
      }

      // Notify accountants that a request is ready for payout
      const { data: payoutExecutors } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['accountant', 'owner', 'admin']);
      
      if (payoutExecutors) {
        for (const executor of payoutExecutors) {
          if (executor.user_id !== user?.id) {
            await supabase.rpc('create_notification', {
              _user_id: executor.user_id,
              _title: 'Request Ready for Payout',
              _message: `Advance request for ${request.staff?.full_name} (₹${request.amount.toLocaleString('en-IN')}) is approved and ready in Payouts.`,
              _type: 'info',
              _reference_type: 'payment_request',
              _reference_id: request.id,
            });
          }
        }
      }

      toast.success('Request approved - now available in Payouts');
      fetchRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve request');
    } finally {
      setIsProcessing(false);
      setSelectedRequest(null);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('payment_requests')
        .update({
          status: 'rejected',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason,
        })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      // Notify the staff member
      if (selectedRequest.staff?.user_id) {
        await supabase.rpc('create_notification', {
          _user_id: selectedRequest.staff.user_id,
          _title: 'Request Rejected',
          _message: `Your payment request of ₹${selectedRequest.amount.toLocaleString('en-IN')} has been rejected. Reason: ${rejectionReason}`,
          _type: 'error',
          _reference_type: 'payment_request',
          _reference_id: selectedRequest.id,
        });
      }

      toast.success('Request rejected');
      setRejectionReason('');
      fetchRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Failed to reject request');
    } finally {
      setIsProcessing(false);
      setSelectedRequest(null);
    }
  };

  // Permission checks using centralized auth context
  // Owner and Admin can approve - Accountant CANNOT approve
  const canApprove = canApproveRequests;
  
  // Staff, Accountant, and Admin can create requests
  // Owner can also create but usually doesn't need to
  const canCreateRequest = isStaff || isAccountant || isAdmin || isOwner;

  return (
    <div>
      <PageHeader
        title="Payment Requests"
        description={
          canApprove
            ? "Review and approve payment requests. Approved requests go to Payouts."
            : "View and create payment requests"
        }
      >
        {canCreateRequest && (
          <Link to="/requests/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Request
            </Button>
          </Link>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          {requests.length === 0 && !isLoading ? (
            <EmptyState
              icon={ClipboardList}
              title="No requests found"
              description={
                activeTab === 'pending'
                  ? "No pending requests at the moment"
                  : "No requests match the selected filter"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead className="max-w-[300px]">Reason</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(request.created_at), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{request.staff?.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {request.staff?.employee_id}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <p className="truncate">{request.reason}</p>
                        {request.rejection_reason && (
                          <p className="text-xs text-destructive mt-1">
                            Rejected: {request.rejection_reason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={request.amount} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={request.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {/* Approve/Reject buttons - only for Owner/Admin on pending */}
                          {canApprove && request.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-success hover:text-success"
                                onClick={() => handleApprove(request)}
                                disabled={isProcessing}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setSelectedRequest(request)}
                                disabled={isProcessing}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          
                          {/* "Go to Payouts" indicator for approved requests */}
                          {request.status === 'approved' && (isOwner || isAdmin || isAccountant) && (
                            <Link to="/payouts">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-xs"
                              >
                                Payouts
                                <ArrowRight className="h-3 w-3" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rejection Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason for rejection</Label>
              <Textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter reason..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedRequest(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isProcessing || !rejectionReason.trim()}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                'Reject Request'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
