 import { useState, useEffect } from 'react';
 import { supabase } from '@/integrations/supabase/client';
 import { useAuth } from '@/contexts/AuthContext';
 import { Label } from '@/components/ui/label';
 import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
 } from '@/components/ui/select';
 import { Loader2 } from 'lucide-react';
 
 interface PaidByUser {
   id: string;
   email: string;
   name: string;
   role: string;
 }
 
 interface PaidBySelectorProps {
   value: { userId: string; userName: string } | null;
   onChange: (value: { userId: string; userName: string }) => void;
   disabled?: boolean;
 }
 
 /**
  * PaidBySelector - Dropdown to select who made the payment
  * 
  * Only shows Owners, Admins, and Accountants.
  * Staff should never see or use this component.
  * Default value is the currently logged-in user.
  */
 export function PaidBySelector({ value, onChange, disabled }: PaidBySelectorProps) {
   const { user, isStaff } = useAuth();
   const [users, setUsers] = useState<PaidByUser[]>([]);
   const [isLoading, setIsLoading] = useState(true);
 
   useEffect(() => {
     fetchEligibleUsers();
   }, []);
 
   const fetchEligibleUsers = async () => {
     try {
       setIsLoading(true);
       
       // Fetch users with Owner, Admin, or Accountant roles
       const { data: roleData, error: roleError } = await supabase
         .from('user_roles')
         .select('user_id, role')
         .in('role', ['owner', 'admin', 'accountant']);
 
       if (roleError) throw roleError;
 
       if (!roleData || roleData.length === 0) {
         setUsers([]);
         return;
       }
 
       // Get unique user IDs
       const userIds = [...new Set(roleData.map(r => r.user_id))];
       
       // Try to get staff names for these users
       const { data: staffData } = await supabase
         .from('staff')
         .select('user_id, full_name, email')
         .in('user_id', userIds);
 
       // Build user list with names
       const userList: PaidByUser[] = [];
       
       for (const userId of userIds) {
         const userRoles = roleData.filter(r => r.user_id === userId);
         const staffRecord = staffData?.find(s => s.user_id === userId);
         
         // Get highest priority role for display
         let displayRole = 'User';
         if (userRoles.some(r => r.role === 'owner')) displayRole = 'Owner';
         else if (userRoles.some(r => r.role === 'admin')) displayRole = 'Admin';
         else if (userRoles.some(r => r.role === 'accountant')) displayRole = 'Accountant';
 
         const name = staffRecord?.full_name || 
                      staffRecord?.email?.split('@')[0] || 
                      (userId === user?.id ? 'You' : 'Unknown User');
         
         userList.push({
           id: userId,
           email: staffRecord?.email || '',
           name: userId === user?.id ? `${name} (You)` : name,
           role: displayRole,
         });
       }
 
       // Sort: current user first, then by role priority
       userList.sort((a, b) => {
         if (a.id === user?.id) return -1;
         if (b.id === user?.id) return 1;
         const roleOrder = { 'Owner': 1, 'Admin': 2, 'Accountant': 3, 'User': 4 };
         return (roleOrder[a.role as keyof typeof roleOrder] || 4) - 
                (roleOrder[b.role as keyof typeof roleOrder] || 4);
       });
 
       setUsers(userList);
 
       // Set default value to current user if not already set
       if (!value && user?.id) {
         const currentUser = userList.find(u => u.id === user.id);
         if (currentUser) {
           onChange({ userId: currentUser.id, userName: currentUser.name.replace(' (You)', '') });
         }
       }
     } catch (error) {
       console.error('Error fetching eligible users:', error);
     } finally {
       setIsLoading(false);
     }
   };
 
   // Staff should never see this component
   if (isStaff) {
     return null;
   }
 
   const handleValueChange = (userId: string) => {
     const selectedUser = users.find(u => u.id === userId);
     if (selectedUser) {
       onChange({ 
         userId: selectedUser.id, 
         userName: selectedUser.name.replace(' (You)', '') 
       });
     }
   };
 
   if (isLoading) {
     return (
       <div className="space-y-2">
         <Label className="text-xs sm:text-sm">Payment Made By</Label>
         <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
           <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
           <span className="text-sm text-muted-foreground">Loading...</span>
         </div>
       </div>
     );
   }
 
   return (
     <div className="space-y-2">
       <Label className="text-xs sm:text-sm">Payment Made By</Label>
       <Select 
         value={value?.userId || ''} 
         onValueChange={handleValueChange}
         disabled={disabled}
       >
         <SelectTrigger className="text-sm">
           <SelectValue placeholder="Select who made the payment" />
         </SelectTrigger>
         <SelectContent className="bg-popover">
           {users.map((u) => (
             <SelectItem key={u.id} value={u.id}>
               <span className="flex items-center gap-2">
                 <span>{u.name}</span>
                 <span className="text-xs text-muted-foreground">({u.role})</span>
               </span>
             </SelectItem>
           ))}
         </SelectContent>
       </Select>
     </div>
   );
 }