import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Search, Users, MoreHorizontal, Eye, Edit, FileText } from 'lucide-react';
import { format } from 'date-fns';
import type { Staff } from '@/types/database';

export default function StaffList() {
  const { canViewSalaries, isOwner } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    try {
      // Only owners can access full staff table with salary
      // This page should only be accessible to owners anyway
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .order('full_name');

      if (error) throw error;
      setStaff(data as Staff[] || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredStaff = staff.filter(s =>
    s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.employee_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div>
      <PageHeader
        title="Staff Management"
        description="Manage your team members and their details"
      >
        {isOwner && (
          <Link to="/staff/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Staff
            </Button>
          </Link>
        )}
      </PageHeader>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Staff Table */}
      <Card>
        <CardContent className="p-0">
          {filteredStaff.length === 0 && !isLoading ? (
            <EmptyState
              icon={Users}
              title="No staff found"
              description={searchQuery ? "Try adjusting your search" : "Add your first team member"}
              action={
                !searchQuery && isOwner
                  ? <Link to="/staff/new"><Button>Add Staff</Button></Link>
                  : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Designation</TableHead>
                    {/* SALARY CONFIDENTIALITY: Only show salary column to Owner */}
                    {canViewSalaries && (
                      <TableHead className="text-right">Salary</TableHead>
                    )}
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStaff.map((member) => (
                    <TableRow key={member.id} className="hover:bg-secondary/30">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {getInitials(member.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{member.full_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {member.employee_id}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{member.department || '-'}</TableCell>
                      <TableCell>{member.designation || '-'}</TableCell>
                      {/* SALARY CONFIDENTIALITY: Only show salary value to Owner */}
                      {canViewSalaries && (
                        <TableCell className="text-right">
                          <Amount value={member.monthly_salary} />
                        </TableCell>
                      )}
                      <TableCell>
                        <StatusBadge status={member.is_active ? 'active' : 'inactive'} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(member.date_of_joining), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/staff/${member.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </Link>
                            </DropdownMenuItem>
                            {isOwner && (
                              <DropdownMenuItem asChild>
                                <Link to={`/staff/${member.id}/edit`}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </Link>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem asChild>
                              <Link to={`/ledger?staff=${member.id}`}>
                                <FileText className="mr-2 h-4 w-4" />
                                View Ledger
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}