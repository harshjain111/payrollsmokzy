import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AmountInput } from '@/components/ui/amount';
import { Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import type { StaffPublic } from '@/types/database';

const requestSchema = z.object({
  staffId: z.string().min(1, 'Please select a staff member'),
  amount: z.number().min(1, 'Amount must be greater than 0'),
  reason: z.string().min(5, 'Please provide a valid reason').max(500, 'Reason is too long'),
});

export default function NewRequest() {
  const navigate = useNavigate();
  const { user, staffData, isAccountant, accountingMode, isStaff } = useAuth();

  const [staffList, setStaffList] = useState<StaffPublic[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingStaff, setIsFetchingStaff] = useState(true);

  // Staff creating for themselves
  const isPersonalRequest = isStaff || (isAccountant && !accountingMode);

  useEffect(() => {
    if (isPersonalRequest && staffData?.id) {
      setSelectedStaff(staffData.id);
      setIsFetchingStaff(false);
    } else {
      fetchStaffList();
    }
  }, [isPersonalRequest, staffData?.id]);

  const fetchStaffList = async () => {
    try {
      const { data, error } = await supabase
        .from('staff_public')
        .select('*')
        .eq('is_active', true)
        .order('full_name');

      if (error) throw error;
      setStaffList(data as StaffPublic[] || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setIsFetchingStaff(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      requestSchema.parse({
        staffId: selectedStaff,
        amount,
        reason,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.from('payment_requests').insert({
        staff_id: selectedStaff,
        requested_by: user?.id,
        amount,
        reason: reason.trim(),
      });

      if (error) throw error;

      toast.success('Request submitted successfully');
      navigate('/requests');
    } catch (error) {
      console.error('Error creating request:', error);
      toast.error('Failed to create request');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="New Payment Request"
        description="Submit a request for payment or advance"
      >
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </PageHeader>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Request Details</CardTitle>
          <CardDescription>
            Fill in the details for your payment request
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Staff Selection */}
            {!isPersonalRequest && (
              <div className="space-y-2">
                <Label htmlFor="staff">Staff Member</Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name} ({s.employee_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Personal request indicator */}
            {isPersonalRequest && staffData && (
              <div className="p-4 bg-secondary rounded-lg">
                <p className="text-sm text-muted-foreground">Requesting for</p>
                <p className="font-medium">{staffData.full_name}</p>
              </div>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <AmountInput
                value={amount}
                onChange={setAmount}
                placeholder="Enter amount"
              />
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide a reason for this request..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {reason.length}/500 characters
              </p>
            </div>

            {/* Submit */}
            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(-1)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
