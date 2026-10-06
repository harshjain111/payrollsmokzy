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
import { Badge } from '@/components/ui/badge';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Search, Users, MoreHorizontal, Edit, Trash2, Link as LinkIcon, Key, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
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
import { ResetPasswordDialog } from '@/components/users/ResetPasswordDialog';
import type { AppRole } from '@/types/database';

interface UserWithRole {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  staff_id: string | null;
  staff_name: string | null;
  last_sign_in: string | null;
}

export default function UsersList() {
  const { isOwner } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithRole | null>(null);
  const [removeUser, setRemoveUser] = useState<UserWithRole | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      
      // Get current session for auth header
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated");
      }

      // Call edge function to get users with auth metadata
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-users`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch users');
      }

      setUsers(data.users || []);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      setLoadError(error.message || 'Failed to load users.');
      toast({
        title: 'Error',
        description: error.message || 'Failed to load users.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = users.filter(u =>
    (u.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (u.phone || '').includes(searchQuery) ||
    (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeVariant = (role: AppRole): "default" | "secondary" | "destructive" | "outline" => {
    switch (role) {
      case 'owner': return 'default';
      case 'admin': return 'secondary';
      default: return 'outline';
    }
  };

  const getRoleLabel = (role: AppRole) => {
    return role.charAt(0).toUpperCase() + role.slice(1);
  };

  const handleDelete = async (user: UserWithRole) => {
    if (user.role === 'owner') {
      toast({
        title: 'Cannot Delete',
        description: 'Owner accounts cannot be deleted.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setDeletingId(user.id);

      // Delete user role
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: 'Access Removed',
        description: `${user.full_name || 'User'} no longer has a role and can't open any page.`,
      });

      setRemoveUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete user.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOwner) {
    return (
      <EmptyState
        icon={Users}
        title="Access Denied"
        description="Only owners can manage users"
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Manage user accounts and role assignments"
      >
        <Button asChild>
          <Link to="/users/new">
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Link>
        </Button>
      </PageHeader>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && users.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading users...
            </div>
          ) : loadError && users.length === 0 ? (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load users"
              description="Check your internet connection and try again."
              action={
                <Button variant="outline" onClick={fetchUsers}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              }
            />
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No users found"
              description={searchQuery ? "Try adjusting your search" : "Add your first user"}
              action={
                !searchQuery
                  ? <Button asChild><Link to="/users/new">Add User</Link></Button>
                  : undefined
              }
            />
          ) : (
            <>
            <div className="divide-y md:hidden">
              {filteredUsers.map((user) => (
                <div key={user.id} className="space-y-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0"><AvatarFallback className="bg-primary/10 text-sm text-primary">{getInitials(user.full_name || undefined)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{user.full_name || 'Unknown'}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.phone || user.email || 'No contact'}</p>
                    </div>
                    <Badge variant={getRoleBadgeVariant(user.role)}>{getRoleLabel(user.role)}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{user.staff_name || 'Not linked to staff'}</span>
                    <span className="shrink-0">{format(new Date(user.created_at), 'dd MMM yyyy')}</span>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button asChild size="sm" variant="outline"><Link to={`/users/${user.user_id}/edit`}><Edit className="mr-2 h-4 w-4" />Edit</Link></Button>
                    <Button size="sm" variant="outline" onClick={() => setResetPasswordUser(user)}><Key className="mr-2 h-4 w-4" />Password</Button>
                    {user.role !== 'owner' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRemoveUser(user)}
                        aria-label={`Remove access for ${user.full_name || 'user'}`}
                      >
                        <Trash2 className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Remove</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>User</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Linked Staff</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} className="hover:bg-secondary/30">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {getInitials(user.full_name || undefined)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">
                              {user.full_name || 'Unknown'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {user.email || '-'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {user.phone || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(user.role)}>
                          {getRoleLabel(user.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.staff_id ? (
                          <Link 
                            to={`/staff/${user.staff_id}`}
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            <LinkIcon className="h-3 w-3" />
                            {user.staff_name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(user.created_at), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${user.full_name || 'user'}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/users/${user.user_id}/edit`}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit User
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setResetPasswordUser(user)}>
                              <Key className="mr-2 h-4 w-4" />
                              Reset Password
                            </DropdownMenuItem>
                            {user.role !== 'owner' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setRemoveUser(user)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Remove Access
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
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

      {/* Remove Access Dialog (shared by mobile cards and desktop table) */}
      <AlertDialog open={!!removeUser} onOpenChange={(open) => !open && setRemoveUser(null)}>
        <AlertDialogContent className="max-w-[90vw] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User Access</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the role for{' '}
              <strong>{removeUser?.full_name || 'this user'}</strong>? They will lose access to all pages
              (they can still sign in but will see "Role Not Assigned"). Their staff record and history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeUser) handleDelete(removeUser);
              }}
              disabled={!!removeUser && deletingId === removeUser.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeUser && deletingId === removeUser.id ? 'Removing...' : 'Remove Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <ResetPasswordDialog
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
        userId={resetPasswordUser?.user_id || ''}
        userName={resetPasswordUser?.full_name || 'User'}
        onSuccess={fetchUsers}
      />
    </div>
  );
}
