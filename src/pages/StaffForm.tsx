import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AmountInput } from '@/components/ui/amount';
import { ArrowLeft, CalendarIcon, Save, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { AppRole } from '@/types/database';

export default function StaffForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user, isOwner } = useAuth();
  const isEditing = !!id;
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(isEditing);
  
  // Form state
  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState<'staff' | 'accountant'>('staff');
  const [monthlySalary, setMonthlySalary] = useState(0);
  const [dateOfJoining, setDateOfJoining] = useState<Date>(new Date());
  const [isActive, setIsActive] = useState(true);
  const [salaryChangeReason, setSalaryChangeReason] = useState('');
  const [originalSalary, setOriginalSalary] = useState(0);

  useEffect(() => {
    if (!isOwner) {
      toast({
        title: 'Access Denied',
        description: 'Only owners can manage staff.',
        variant: 'destructive',
      });
      navigate('/dashboard');
      return;
    }
    
    if (isEditing) {
      fetchStaffData();
    }
  }, [id, isOwner]);

  const fetchStaffData = async () => {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        setFullName(data.full_name);
        setEmployeeId(data.employee_id);
        // email is auto-generated, no need to load
        setPhone(data.phone || '');
        setDepartment(data.department || '');
        setDesignation(data.designation || '');
        setMonthlySalary(Number(data.monthly_salary));
        setOriginalSalary(Number(data.monthly_salary));
        setDateOfJoining(new Date(data.date_of_joining));
        setIsActive(data.is_active ?? true);

        // Fetch role
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', data.user_id)
          .single();

        if (roleData && (roleData.role === 'staff' || roleData.role === 'accountant')) {
          setRole(roleData.role);
        }
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
      toast({
        title: 'Error',
        description: 'Failed to load staff data.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generateEmployeeId = () => {
    const prefix = 'EMP';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${random}`;
  };

  const handleSubmit = async () => {
    // Validation
    if (!fullName.trim()) {
      toast({ title: 'Validation Error', description: 'Full name is required.', variant: 'destructive' });
      return;
    }
    if (!employeeId.trim()) {
      toast({ title: 'Validation Error', description: 'Employee ID is required.', variant: 'destructive' });
      return;
    }
    if (monthlySalary <= 0) {
      toast({ title: 'Validation Error', description: 'Monthly salary must be greater than 0.', variant: 'destructive' });
      return;
    }

    // Check if salary changed and requires reason
    const salaryChanged = isEditing && monthlySalary !== originalSalary;
    if (salaryChanged && !salaryChangeReason.trim()) {
      toast({ title: 'Validation Error', description: 'Please provide a reason for salary change.', variant: 'destructive' });
      return;
    }

    try {
      setIsSubmitting(true);

      if (isEditing) {
        // Update existing staff
        const { error: staffError } = await supabase
          .from('staff')
          .update({
            full_name: fullName.trim(),
            employee_id: employeeId.trim(),
            email: `${employeeId.trim().toLowerCase()}@internal.smokzy.com`,
            phone: phone.trim() || null,
            department: department.trim() || null,
            designation: designation.trim() || null,
            monthly_salary: monthlySalary,
            date_of_joining: format(dateOfJoining, 'yyyy-MM-dd'),
            is_active: isActive,
          })
          .eq('id', id);

        if (staffError) throw staffError;

        // If salary changed, record in salary history
        if (salaryChanged) {
          // Close previous salary history record
          await supabase
            .from('salary_history')
            .update({ effective_to: format(new Date(), 'yyyy-MM-dd') })
            .eq('staff_id', id)
            .is('effective_to', null);

          // Create new salary history record
          const { error: historyError } = await supabase
            .from('salary_history')
            .insert({
              staff_id: id,
              monthly_salary: monthlySalary,
              effective_from: format(new Date(), 'yyyy-MM-dd'),
              changed_by: user?.id,
              change_reason: salaryChangeReason.trim(),
            });

          if (historyError) throw historyError;
        }

        toast({ title: 'Staff Updated', description: `${fullName} has been updated successfully.` });
      } else {
        // Create new staff - first create auth user
        // Create staff without linking to auth user (can be linked later)
        const { data: newStaff, error: staffError } = await supabase
          .from('staff')
          .insert({
            user_id: null,
            full_name: fullName.trim(),
            employee_id: employeeId.trim(),
            email: `${employeeId.trim().toLowerCase()}@internal.smokzy.com`,
            phone: phone.trim() || null,
            department: department.trim() || null,
            designation: designation.trim() || null,
            monthly_salary: monthlySalary,
            date_of_joining: format(dateOfJoining, 'yyyy-MM-dd'),
            is_active: isActive,
            created_by: user?.id,
          })
          .select()
          .single();

        if (staffError) throw staffError;

        // Create initial salary history
        const { error: historyError } = await supabase
          .from('salary_history')
          .insert({
            staff_id: newStaff.id,
            monthly_salary: monthlySalary,
            effective_from: format(dateOfJoining, 'yyyy-MM-dd'),
            changed_by: user?.id,
            change_reason: 'Initial salary on joining',
          });

        if (historyError) console.error('Salary history error:', historyError);

        // Note: User role will be created when staff is linked to an auth account

        toast({ title: 'Staff Created', description: `${fullName} has been added successfully.` });
      }

      navigate('/staff');
    } catch (error: any) {
      console.error('Error saving staff:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save staff. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? 'Edit Staff' : 'Add Staff'}
        description={isEditing ? 'Update staff information' : 'Add a new team member'}
      >
        <Button variant="ghost" onClick={() => navigate('/staff')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </PageHeader>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Staff Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employeeId">Employee ID *</Label>
              <div className="flex gap-2">
                <Input
                  id="employeeId"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="EMP1234"
                />
                {!isEditing && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => setEmployeeId(generateEmployeeId())}
                  >
                    Generate
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="space-y-2">
              <Label>Date of Joining</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !dateOfJoining && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateOfJoining ? format(dateOfJoining, 'PPP') : 'Pick a date (optional)'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateOfJoining}
                    onSelect={(date) => setDateOfJoining(date || new Date())}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Operations"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="designation">Designation</Label>
              <Input
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Manager"
              />
            </div>
          </div>

          {/* Role */}
          <div className="space-y-2">
            <Label>Role *</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'staff' | 'accountant')}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="accountant">Accountant</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Monthly Salary (₹) *</Label>
            <AmountInput
              value={monthlySalary}
              onChange={setMonthlySalary}
              placeholder="0.00"
            />
          </div>

          {/* Salary change reason (only for editing) */}
          {isEditing && monthlySalary !== originalSalary && (
            <div className="space-y-2 p-4 bg-warning/10 rounded-lg border border-warning/20">
              <Label htmlFor="salaryReason">Reason for Salary Change *</Label>
              <Textarea
                id="salaryReason"
                value={salaryChangeReason}
                onChange={(e) => setSalaryChangeReason(e.target.value)}
                placeholder="Annual increment, promotion, etc."
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Previous salary: ₹{originalSalary.toLocaleString('en-IN')} → New: ₹{monthlySalary.toLocaleString('en-IN')}
              </p>
            </div>
          )}

          {/* Active Status */}
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div>
              <Label htmlFor="isActive">Active Status</Label>
              <p className="text-sm text-muted-foreground">
                Inactive staff cannot receive payments
              </p>
            </div>
            <Switch
              id="isActive"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate('/staff')} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} className="flex-1">
              {isEditing ? (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {isSubmitting ? 'Creating...' : 'Add Staff'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
