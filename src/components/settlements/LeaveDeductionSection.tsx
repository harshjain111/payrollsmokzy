 import { useState, useEffect } from 'react';
 import { supabase } from '@/integrations/supabase/client';
 import { useAuth } from '@/contexts/AuthContext';
 import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
 import { Label } from '@/components/ui/label';
 import { Input } from '@/components/ui/input';
 import { Textarea } from '@/components/ui/textarea';
 import { Badge } from '@/components/ui/badge';
 import { Button } from '@/components/ui/button';
 import { Alert, AlertDescription } from '@/components/ui/alert';
 import { Separator } from '@/components/ui/separator';
 import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
 import { Calendar, ChevronDown, ChevronUp, AlertTriangle, Info } from 'lucide-react';
 import { format } from 'date-fns';
 import { Amount } from '@/components/ui/amount';
 import type { LeaveRecord } from '@/types/leave';
 import { LEAVE_TYPE_CONFIG } from '@/types/leave';
 
 interface LeaveDeductionSectionProps {
   staffId: string;
   month: string;
   dailySalary: number;
   onDeductionChange: (systemDays: number, finalDays: number, reason?: string) => void;
   disabled?: boolean;
 }
 
 export function LeaveDeductionSection({
   staffId,
   month,
   dailySalary,
   onDeductionChange,
   disabled,
 }: LeaveDeductionSectionProps) {
   const { userRole } = useAuth();
   const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
   const [isLoading, setIsLoading] = useState(false);
   const [isExpanded, setIsExpanded] = useState(false);
   
   // System-calculated values (read-only)
   const [systemDeductionDays, setSystemDeductionDays] = useState(0);
   
   // Owner override values
   const [finalDeductionDays, setFinalDeductionDays] = useState(0);
   const [adjustmentReason, setAdjustmentReason] = useState('');
 
   const isOwner = userRole === 'owner';
   const hasOverride = finalDeductionDays < systemDeductionDays;
 
   useEffect(() => {
     if (staffId && month) {
       fetchLeaveData();
     }
   }, [staffId, month]);
 
   useEffect(() => {
     onDeductionChange(systemDeductionDays, finalDeductionDays, adjustmentReason);
   }, [systemDeductionDays, finalDeductionDays, adjustmentReason]);
 
   const fetchLeaveData = async () => {
     try {
       setIsLoading(true);
 
       // Get system deduction days from RPC
       const { data: deductionData, error: deductionError } = await supabase
         .rpc('get_system_deduction_days', {
           _staff_id: staffId,
           _month: month,
         });
 
       if (deductionError) throw deductionError;
 
       const systemDays = Number(deductionData) || 0;
       setSystemDeductionDays(systemDays);
       setFinalDeductionDays(systemDays); // Default to system value
 
       // Fetch individual leave records for display
       const { data: recordsData, error: recordsError } = await supabase
         .rpc('get_monthly_leave_records', {
           _staff_id: staffId,
           _month: month,
         });
 
       if (recordsError) throw recordsError;
       
       setLeaveRecords((recordsData as unknown as LeaveRecord[]) || []);
     } catch (error) {
       console.error('Error fetching leave data:', error);
     } finally {
       setIsLoading(false);
     }
   };
 
   const handleFinalDeductionChange = (value: number) => {
     // Owner can only REDUCE deduction, never increase
     const clamped = Math.min(systemDeductionDays, Math.max(0, value));
     setFinalDeductionDays(clamped);
   };
 
   const systemDeductionAmount = systemDeductionDays * dailySalary;
   const finalDeductionAmount = finalDeductionDays * dailySalary;
   const adjustmentAmount = systemDeductionAmount - finalDeductionAmount;
 
   if (isLoading) {
     return (
       <Card>
         <CardContent className="py-6">
           <div className="flex items-center justify-center">
             <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
           </div>
         </CardContent>
       </Card>
     );
   }
 
   return (
     <Card className={hasOverride ? 'border-success' : ''}>
       <CardHeader className="pb-3">
         <div className="flex items-center justify-between">
           <div>
             <CardTitle className="text-base flex items-center gap-2">
               <Calendar className="h-4 w-4" />
               Leave Deduction
             </CardTitle>
             <CardDescription>
               Based on approved leave records for this month
             </CardDescription>
           </div>
           <Badge variant={leaveRecords.length > 0 ? 'default' : 'secondary'}>
             {leaveRecords.length} leave{leaveRecords.length !== 1 ? 's' : ''}
           </Badge>
         </div>
       </CardHeader>
 
       <CardContent className="space-y-4">
         {/* System Calculation (Read-Only) */}
         <div className="rounded-lg border p-4 bg-muted/30">
           <div className="flex justify-between items-center">
             <div>
               <p className="text-sm font-medium">System Calculated Deduction</p>
               <p className="text-xs text-muted-foreground">
                 Based on {leaveRecords.length} approved leave record{leaveRecords.length !== 1 ? 's' : ''}
               </p>
             </div>
             <div className="text-right">
               <p className="text-lg font-bold">{systemDeductionDays} days</p>
               <p className="text-sm text-muted-foreground">
                 <Amount value={systemDeductionAmount} />
               </p>
             </div>
           </div>
         </div>
 
         {/* Leave Records Collapsible */}
         {leaveRecords.length > 0 && (
           <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
             <CollapsibleTrigger asChild>
               <Button variant="ghost" size="sm" className="w-full justify-between">
                 <span className="text-sm">View Leave Details</span>
                 {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
               </Button>
             </CollapsibleTrigger>
             <CollapsibleContent className="space-y-2 pt-2">
               {leaveRecords.map((record) => (
                 <div 
                   key={record.id} 
                   className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/50"
                 >
                   <div>
                     <span className="font-medium">
                       {format(new Date(record.leave_date), 'dd MMM yyyy')}
                     </span>
                     <Badge variant="outline" className="ml-2 text-xs">
                       {LEAVE_TYPE_CONFIG[record.leave_type]?.label || record.leave_type}
                     </Badge>
                   </div>
                   <span className="font-medium">{record.deduction_days} day{record.deduction_days !== 1 ? 's' : ''}</span>
                 </div>
               ))}
             </CollapsibleContent>
           </Collapsible>
         )}
 
         <Separator />
 
         {/* Owner Override Section */}
         <div className="space-y-3">
           <div className="flex items-center gap-2">
             <Label htmlFor="finalDeduction" className="font-medium">
               Final Deduction Days
             </Label>
             {isOwner && (
               <Badge variant="outline" className="text-xs">Owner Override</Badge>
             )}
           </div>
 
           <div className="flex items-center gap-4">
             <Input
               id="finalDeduction"
               type="number"
               min="0"
               max={systemDeductionDays}
               step="0.5"
               value={finalDeductionDays}
               onChange={(e) => handleFinalDeductionChange(Number(e.target.value) || 0)}
               disabled={disabled || !isOwner}
               className="w-32"
             />
             <div className="flex-1">
               <p className="text-sm">
                 Deduction: <Amount value={finalDeductionAmount} className="font-medium" />
               </p>
               {hasOverride && (
                 <p className="text-xs text-success">
                   Saving ₹{adjustmentAmount.toLocaleString('en-IN')} for staff (goodwill)
                 </p>
               )}
             </div>
           </div>
 
           {!isOwner && (
             <Alert>
               <Info className="h-4 w-4" />
               <AlertDescription>
                 Only the Owner can adjust the final deduction amount.
               </AlertDescription>
             </Alert>
           )}
 
           {isOwner && systemDeductionDays > 0 && (
             <>
               <p className="text-xs text-muted-foreground">
                 You can reduce the deduction (e.g., for goodwill) but cannot increase it beyond the system-calculated value.
               </p>
 
               {hasOverride && (
                 <div className="space-y-2">
                   <Label htmlFor="adjustmentReason">Adjustment Reason (Optional)</Label>
                   <Textarea
                     id="adjustmentReason"
                     value={adjustmentReason}
                     onChange={(e) => setAdjustmentReason(e.target.value)}
                     placeholder="e.g., Good performance this quarter, Medical emergency..."
                     rows={2}
                     disabled={disabled}
                   />
                 </div>
               )}
             </>
           )}
         </div>
 
         {/* Warning if no leave records but manual entry exists */}
         {leaveRecords.length === 0 && systemDeductionDays === 0 && (
           <Alert>
             <Info className="h-4 w-4" />
             <AlertDescription>
               No approved leave records found for this month. Leave deductions will be based on approved records only.
             </AlertDescription>
           </Alert>
         )}
       </CardContent>
     </Card>
   );
 }