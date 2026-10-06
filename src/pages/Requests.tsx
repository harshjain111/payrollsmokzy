import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getUserDisplayName } from '@/lib/get-user-display-name';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, ClipboardList, Check, X, Loader2, ArrowRight, Ban, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { PaymentRequest, StaffPublic } from '@/types/database';
import { refetchNotificationCounts } from '@/hooks/useNotificationCounts';
import { CancelApprovalDialog } from '@/components/expenses/CancelApprovalDialog';

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
    canApproveRequests,
    isHR,
  } = useAuth();
  
  const [searchParams] = useSearchParams();
  const [requests, setRequests] = useState<RequestWithStaff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestWithStaff | null>(null);
  const [approveTarget, setApproveTarget] = useState<RequestWithStaff | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // Dashboards deep-link with ?status=pending|approved|rejected|all (and ?escalated=true → pending queue)
  const [activeTab, setActiveTab] = useState(() => {
    const status = searchParams.get('status');
    if (status && ['pending', 'approved', 'rejected', 'all'].includes(status)) return status;
    return 'pending';
  });
  const [cancelRequest, setCancelRequest] = useState<RequestWithStaff | null>(null);
  // Ignore responses from an older fetch (e.g. after switching tabs quickly)
  const fetchSeq = useRef(0);

  useEffect(() => {
    fetchRequests();
  }, [staffData?.id, activeTab, accountingMode]);

  const fetchRequests = async () => {
    const seq = ++fetchSeq.current;
    setIsLoading(true);
    setLoadError(false);
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

      // CRITICAL: Personal context filtering
      // Staff always sees only their own requests
      // Accountant in personal mode (My Account) sees only their own requests
      // This ensures complete isolation between personal and role contexts
      if (isStaff || isHR || (isAccountant && !accountingMode)) {
        if (staffData?.id) {
          query = query.eq('staff_id', staffData.id);
        } else {
          // No staff record - return empty
          setRequests([]);
          setIsLoading(false);
          return;
        }
      }

      // Filter by status
      if (activeTab !== 'all' && (activeTab === 'pending' || activeTab === 'approved' || activeTab === 'rejected')) {
        query = query.eq('status', activeTab);
      }

      const { data, error } = await query;

      if (error) throw error;
      if (seq !== fetchSeq.current) return;
      setRequests(data as RequestWithStaff[] || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
      if (seq !== fetchSeq.current) return;
      setRequests([]);
      setLoadError(true);
      toast.error('Could not load requests. Check your connection and try again.');
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false);
    }
  };

  const handleApprove = async (request: RequestWithStaff) => {
    // Prevent self-benefit approval - cannot approve requests where YOU are the beneficiary
    // But you CAN approve requests you created on behalf of others
    if (request.staff?.user_id === user?.id) {
      toast.error('You cannot approve requests for yourself');
      setApproveTarget(null);
      return;
    }

    setIsProcessing(true);
    try {
      const approverName = getUserDisplayName(user, staffData);

      const { data, error } = await supabase
        .from('payment_requests')
        .update({
          status: 'approved',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          approved_by_user_name: approverName,
        })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error('This request was already handled by someone else');
        fetchRequests();
        return;
      }

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
      
      // Immediately update notification counts
      refetchNotificationCounts();
      
      fetchRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Failed to approve request');
    } finally {
      setIsProcessing(false);
      setApproveTarget(null);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    setIsProcessing(true);
    try {
      const approverName = getUserDisplayName(user, staffData);

      const { error } = await supabase
        .from('payment_requests')
        .update({
          status: 'rejected',
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          rejection_reason: rejectionReason,
          approved_by_user_name: approverName,
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
      
      // Immediately update notification counts
      refetchNotificationCounts();
      
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
  const canCreateRequest = (isStaff || isAccountant || isAdmin || isOwner || isHR) && Boolean(staffData?.id || isAdmin || isOwner || (isAccountant && accountingMode));

  return (
    <div className="space-y-4 sm:space-y-6 pb-6">
      <PageHeader
        title={canApprove || isOwner || isAdmin || (isAccountant && accountingMode) ? 'Advance Requests' : 'Request Advance'}
        description={
          canApprove
            ? "Review and approve advance requests"
            : "View and create advance requests"
        }
      >
        {canCreateRequest && (
          <Link to="/requests/new">
            <Button className="text-sm sm:text-base px-3 sm:px-4">
              <Plus className="mr-1.5 sm:mr-2 h-4 w-4" />
              <span className="hidden sm:inline">New Request</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        )}
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4">
          <TabsTrigger value="pending" className="text-xs sm:text-sm">Pending</TabsTrigger>
          <TabsTrigger value="approved" className="text-xs sm:text-sm">Approved</TabsTrigger>
          <TabsTrigger value="rejected" className="text-xs sm:text-sm">Rejected</TabsTrigger>
          <TabsTrigger value="all" className="text-xs sm:text-sm">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading requests...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">Could not load requests. Please check your connection.</p>
              <Button variant="outline" size="sm" onClick={() => fetchRequests()}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Retry
              </Button>
            </div>
          ) : requests.length === 0 ? (
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
            <>
              {/* Mobile Card View */}
              <div className="block md:hidden divide-y">
                {requests.map((request) => (
                  <div key={request.id} className="p-3 sm:p-4 space-y-2 sm:space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm sm:text-base truncate">{request.staff?.full_name}</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">
                          {request.staff?.employee_id} • {format(new Date(request.created_at), 'dd MMM')}
                        </p>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">{request.reason}</p>
                    {request.approved_by_user_name && request.status !== 'pending' && (
                      <p className="text-[10px] sm:text-xs text-muted-foreground italic">
                        {request.status === 'rejected' ? 'Rejected' : 'Approved'} by: {request.approved_by_user_name}
                      </p>
                    )}
                    {request.rejection_reason && (
                      <p className="text-[10px] sm:text-xs text-destructive line-clamp-1">
                        Reason: {request.rejection_reason}
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-1 sm:pt-2">
                      <Amount value={request.amount} size="lg" />
                      <div className="flex gap-1 sm:gap-2">
                        {canApprove && request.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-success hover:text-success h-9 w-9 p-0"
                              onClick={() => setApproveTarget(request)}
                              disabled={isProcessing}
                              aria-label={`Approve request from ${request.staff?.full_name ?? 'staff'}`}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive h-9 w-9 p-0"
                              onClick={() => setSelectedRequest(request)}
                              disabled={isProcessing}
                              aria-label={`Reject request from ${request.staff?.full_name ?? 'staff'}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {request.status === 'approved' && (isOwner || isAdmin || isAccountant) && (
                          <Link to="/payouts">
                            <Button size="sm" variant="outline" className="gap-1 h-8 text-xs px-2">
                              Payouts
                              <ArrowRight className="h-3 w-3" />
                            </Button>
                          </Link>
                        )}
                        {request.status === 'approved' && !request.paid_at && (isOwner || isAdmin) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive h-9 w-9 p-0"
                            onClick={() => setCancelRequest(request)}
                            title="Cancel Approval"
                            aria-label="Cancel approval"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                     <TableRow className="bg-secondary/50">
                       <TableHead>Date</TableHead>
                       <TableHead>Staff</TableHead>
                       <TableHead className="max-w-[300px]">Reason</TableHead>
                       <TableHead className="text-right">Amount</TableHead>
                       <TableHead>Status</TableHead>
                       <TableHead>Approved By</TableHead>
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
                         <TableCell>
                           {request.approved_by_user_name ? (
                             <span className="text-sm text-muted-foreground">{request.approved_by_user_name}</span>
                           ) : (
                             <span className="text-sm text-muted-foreground">—</span>
                           )}
                         </TableCell>
                         <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canApprove && request.status === 'pending' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-success hover:text-success"
                                  onClick={() => setApproveTarget(request)}
                                  disabled={isProcessing}
                                  aria-label={`Approve request from ${request.staff?.full_name ?? 'staff'}`}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => setSelectedRequest(request)}
                                  disabled={isProcessing}
                                  aria-label={`Reject request from ${request.staff?.full_name ?? 'staff'}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            )}
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
                            {request.status === 'approved' && !request.paid_at && (isOwner || isAdmin) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive gap-1 text-xs"
                                onClick={() => setCancelRequest(request)}
                              >
                                <Ban className="h-3.5 w-3.5" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Rejection Dialog */}
      <Dialog
        open={!!selectedRequest}
        onOpenChange={(open) => {
          if (open || isProcessing) return;
          setSelectedRequest(null);
          setRejectionReason('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejection-reason">Reason for rejection</Label>
              <Textarea
                id="rejection-reason"
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
              onClick={() => {
                setSelectedRequest(null);
                setRejectionReason('');
              }}
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

      {/* Approve confirmation */}
      <AlertDialog
        open={!!approveTarget}
        onOpenChange={(open) => {
          if (!open && !isProcessing) setApproveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this advance?</AlertDialogTitle>
            <AlertDialogDescription>
              {approveTarget && (
                <>
                  Approve <span className="font-medium text-foreground">₹{approveTarget.amount.toLocaleString('en-IN')}</span> for{' '}
                  <span className="font-medium text-foreground">{approveTarget.staff?.full_name || 'this staff member'}</span>?
                  It will then be ready to pay in Payouts.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isProcessing}
              onClick={(e) => {
                // Keep the dialog open (and the button disabled) until the approval finishes
                e.preventDefault();
                if (approveTarget && !isProcessing) handleApprove(approveTarget);
              }}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                'Approve'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Approval Dialog */}
      <CancelApprovalDialog
        open={!!cancelRequest}
        onOpenChange={(open) => !open && setCancelRequest(null)}
        onSuccess={() => {
          setCancelRequest(null);
          fetchRequests();
        }}
        item={cancelRequest ? {
          id: cancelRequest.id,
          type: 'advance',
          staffName: cancelRequest.staff?.full_name || 'Staff',
          staffId: cancelRequest.staff_id,
          staffUserId: cancelRequest.staff?.user_id,
          amount: cancelRequest.amount,
          description: cancelRequest.reason,
        } : null}
      />
    </div>
  );
}
