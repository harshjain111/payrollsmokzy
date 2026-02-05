 import { useState, useEffect } from 'react';
 import { useNavigate } from 'react-router-dom';
 import { supabase } from '@/integrations/supabase/client';
 import { useAuth } from '@/contexts/AuthContext';
 import { PageHeader } from '@/components/layout/PageHeader';
 import { Button } from '@/components/ui/button';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { Badge } from '@/components/ui/badge';
 import { Input } from '@/components/ui/input';
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from '@/components/ui/select';
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from '@/components/ui/table';
 import { EmptyState } from '@/components/layout/EmptyState';
 import { CreateLeaveDialog } from '@/components/leave/CreateLeaveDialog';
 import { LeaveApprovalDialog } from '@/components/leave/LeaveApprovalDialog';
 import { Plus, Calendar, Search, Filter, Clock, CheckCircle, XCircle } from 'lucide-react';
 import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
 import type { LeaveRecord, LeaveStatus, LeaveType } from '@/types/leave';
 import { LEAVE_TYPE_CONFIG, LEAVE_STATUS_LABELS } from '@/types/leave';
 
 interface StaffOption {
   id: string;
   full_name: string;
   employee_id: string;
 }
 
 export default function LeaveRecords() {
   const navigate = useNavigate();
   const { user, userRole, staffData } = useAuth();
   const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
   const [staff, setStaff] = useState<StaffOption[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [showCreateDialog, setShowCreateDialog] = useState(false);
   const [showApprovalDialog, setShowApprovalDialog] = useState(false);
   const [selectedLeave, setSelectedLeave] = useState<LeaveRecord | null>(null);
 
   // Filters
   const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
   const [selectedStaffId, setSelectedStaffId] = useState('all');
   const [selectedStatus, setSelectedStatus] = useState<string>('all');
   const [searchQuery, setSearchQuery] = useState('');
 
   const isStaff = userRole === 'staff';
   const canApprove = userRole === 'owner' || userRole === 'admin' || userRole === 'accountant';
   const canCreate = true; // All roles can create (staff creates requests, others create directly)
 
   useEffect(() => {
     fetchLeaveRecords();
     if (!isStaff) {
       fetchStaff();
     }
   }, [selectedMonth, selectedStaffId, selectedStatus, userRole]);
 
   const fetchStaff = async () => {
     try {
       const { data, error } = await supabase
         .from('staff')
         .select('id, full_name, employee_id')
         .eq('is_active', true)
         .order('full_name');
 
       if (error) throw error;
       setStaff(data || []);
     } catch (error) {
       console.error('Error fetching staff:', error);
     }
   };
 
   const fetchLeaveRecords = async () => {
     try {
       setIsLoading(true);
 
       const monthStart = startOfMonth(new Date(selectedMonth + '-01'));
       const monthEnd = endOfMonth(new Date(selectedMonth + '-01'));
 
       let query = supabase
         .from('leave_records')
         .select(`
           *,
           staff:staff_id (
             id,
             full_name,
             employee_id
           )
         `)
         .gte('leave_date', format(monthStart, 'yyyy-MM-dd'))
         .lte('leave_date', format(monthEnd, 'yyyy-MM-dd'))
         .order('leave_date', { ascending: false });
 
       if (selectedStaffId !== 'all') {
         query = query.eq('staff_id', selectedStaffId);
       }
 
       if (selectedStatus !== 'all') {
         query = query.eq('status', selectedStatus as 'pending' | 'approved' | 'rejected');
       }
 
       const { data, error } = await query;
 
       if (error) throw error;
       setLeaveRecords((data as unknown as LeaveRecord[]) || []);
     } catch (error) {
       console.error('Error fetching leave records:', error);
     } finally {
       setIsLoading(false);
     }
   };
 
   const filteredRecords = leaveRecords.filter((record) => {
     if (searchQuery) {
       const search = searchQuery.toLowerCase();
       return (
         record.staff?.full_name?.toLowerCase().includes(search) ||
         record.staff?.employee_id?.toLowerCase().includes(search) ||
         record.remarks?.toLowerCase().includes(search)
       );
     }
     return true;
   });
 
   const pendingCount = leaveRecords.filter(r => r.status === 'pending').length;
   const approvedCount = leaveRecords.filter(r => r.status === 'approved').length;
   const totalDeductionDays = leaveRecords
     .filter(r => r.status === 'approved')
     .reduce((sum, r) => sum + r.deduction_days, 0);
 
   const monthOptions = Array.from({ length: 12 }, (_, i) => {
     const date = subMonths(new Date(), i);
     return {
       value: format(date, 'yyyy-MM'),
       label: format(date, 'MMMM yyyy'),
     };
   });
 
   const getStatusIcon = (status: LeaveStatus) => {
     switch (status) {
       case 'pending':
         return <Clock className="h-4 w-4" />;
       case 'approved':
         return <CheckCircle className="h-4 w-4" />;
       case 'rejected':
         return <XCircle className="h-4 w-4" />;
     }
   };
 
   const getStatusVariant = (status: LeaveStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
     switch (status) {
       case 'pending':
         return 'secondary';
       case 'approved':
         return 'default';
       case 'rejected':
         return 'destructive';
       default:
         return 'outline';
     }
   };
 
   const handleRowClick = (record: LeaveRecord) => {
     if (canApprove && record.status === 'pending') {
       setSelectedLeave(record);
       setShowApprovalDialog(true);
     }
   };
 
   return (
     <div className="space-y-4 md:space-y-6">
       <PageHeader
         title="Leave Records"
         description={isStaff ? 'View your leave history and submit requests' : 'Manage staff leave and salary deductions'}
       >
         {canCreate && (
           <Button onClick={() => setShowCreateDialog(true)}>
             <Plus className="mr-2 h-4 w-4" />
             {isStaff ? 'Request Leave' : 'Record Leave'}
           </Button>
         )}
       </PageHeader>
 
       {/* Stats Cards */}
       <div className="grid gap-4 md:grid-cols-3">
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">
               Pending Requests
             </CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold text-warning">{pendingCount}</div>
           </CardContent>
         </Card>
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">
               Approved Leaves
             </CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold text-success">{approvedCount}</div>
           </CardContent>
         </Card>
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">
               Total Deduction Days
             </CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{totalDeductionDays}</div>
           </CardContent>
         </Card>
       </div>
 
       {/* Filters */}
       <Card>
         <CardContent className="pt-6">
           <div className="flex flex-col gap-4 md:flex-row md:items-end">
             <div className="flex-1 space-y-2">
               <label className="text-sm font-medium">Search</label>
               <div className="relative">
                 <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                 <Input
                   placeholder="Search by name or ID..."
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="pl-10"
                 />
               </div>
             </div>
 
             <div className="w-full md:w-48 space-y-2">
               <label className="text-sm font-medium">Month</label>
               <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                 <SelectTrigger>
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   {monthOptions.map((month) => (
                     <SelectItem key={month.value} value={month.value}>
                       {month.label}
                     </SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
 
             {!isStaff && (
               <div className="w-full md:w-48 space-y-2">
                 <label className="text-sm font-medium">Staff</label>
                 <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                   <SelectTrigger>
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="all">All Staff</SelectItem>
                     {staff.map((s) => (
                       <SelectItem key={s.id} value={s.id}>
                         {s.full_name}
                       </SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
             )}
 
             <div className="w-full md:w-40 space-y-2">
               <label className="text-sm font-medium">Status</label>
               <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                 <SelectTrigger>
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">All Status</SelectItem>
                   <SelectItem value="pending">Pending</SelectItem>
                   <SelectItem value="approved">Approved</SelectItem>
                   <SelectItem value="rejected">Rejected</SelectItem>
                 </SelectContent>
               </Select>
             </div>
           </div>
         </CardContent>
       </Card>
 
       {/* Leave Records Table */}
       <Card>
         <CardContent className="p-0">
           {isLoading ? (
             <div className="flex items-center justify-center py-12">
               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
             </div>
           ) : filteredRecords.length === 0 ? (
             <EmptyState
               icon={Calendar}
               title="No leave records"
               description={isStaff ? 'You haven\'t submitted any leave requests yet.' : 'No leave records found for the selected filters.'}
               action={
                 canCreate && (
                   <Button onClick={() => setShowCreateDialog(true)}>
                     <Plus className="mr-2 h-4 w-4" />
                     {isStaff ? 'Request Leave' : 'Record Leave'}
                   </Button>
                 )
               }
             />
           ) : (
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Date</TableHead>
                   {!isStaff && <TableHead>Staff</TableHead>}
                   <TableHead>Type</TableHead>
                   <TableHead className="text-right">Deduction</TableHead>
                   <TableHead>Status</TableHead>
                   <TableHead>Remarks</TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {filteredRecords.map((record) => (
                   <TableRow
                     key={record.id}
                     className={canApprove && record.status === 'pending' ? 'cursor-pointer hover:bg-muted/50' : ''}
                     onClick={() => handleRowClick(record)}
                   >
                     <TableCell className="font-medium">
                       {format(new Date(record.leave_date), 'dd MMM yyyy')}
                       <div className="text-xs text-muted-foreground">
                         {format(new Date(record.leave_date), 'EEEE')}
                       </div>
                     </TableCell>
                     {!isStaff && (
                       <TableCell>
                         <div>{record.staff?.full_name}</div>
                         <div className="text-xs text-muted-foreground">
                           {record.staff?.employee_id}
                         </div>
                       </TableCell>
                     )}
                     <TableCell>
                       <Badge variant="outline">
                         {LEAVE_TYPE_CONFIG[record.leave_type]?.label || record.leave_type}
                       </Badge>
                     </TableCell>
                     <TableCell className="text-right font-medium">
                       {record.deduction_days} day{record.deduction_days !== 1 ? 's' : ''}
                     </TableCell>
                     <TableCell>
                       <Badge variant={getStatusVariant(record.status)} className="gap-1">
                         {getStatusIcon(record.status)}
                         {LEAVE_STATUS_LABELS[record.status]}
                       </Badge>
                     </TableCell>
                     <TableCell className="max-w-[200px] truncate text-muted-foreground">
                       {record.rejection_reason || record.remarks || '-'}
                     </TableCell>
                   </TableRow>
                 ))}
               </TableBody>
             </Table>
           )}
         </CardContent>
       </Card>
 
       {/* Create Leave Dialog */}
       <CreateLeaveDialog
         open={showCreateDialog}
         onOpenChange={setShowCreateDialog}
         onSuccess={fetchLeaveRecords}
         staffId={isStaff ? staffData?.id : undefined}
       />
 
       {/* Approval Dialog */}
       <LeaveApprovalDialog
         open={showApprovalDialog}
         onOpenChange={setShowApprovalDialog}
         leaveRecord={selectedLeave}
         onSuccess={fetchLeaveRecords}
       />
     </div>
   );
 }