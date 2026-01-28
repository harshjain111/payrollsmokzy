import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  ClipboardList,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Calculator,
  User,
  Wallet,
  Receipt,
} from 'lucide-react';

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Staff',
    href: '/staff',
    icon: Users,
    roles: ['owner'],
  },
  {
    title: 'Ledger',
    href: '/ledger',
    icon: FileText,
  },
  {
    title: 'Payments',
    href: '/payments',
    icon: CreditCard,
    roles: ['owner', 'accountant'],
  },
  {
    title: 'Expenses',
    href: '/expenses',
    icon: Receipt,
  },
  {
    title: 'Requests',
    href: '/requests',
    icon: ClipboardList,
  },
  {
    title: 'Settlements',
    href: '/settlements',
    icon: Calculator,
    roles: ['owner'],
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['owner', 'ca'],
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, userRole, staffData, signOut, isAccountant, accountingMode, setAccountingMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return item.roles.includes(userRole || '');
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const displayName = staffData?.full_name || user?.email || 'User';
  const roleDisplay = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : '';

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-card px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <span className="text-xl font-bold text-primary">Smokzy</span>
        <NotificationBell />
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-64 transform bg-sidebar transition-transform duration-200 ease-in-out lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-full flex-col">
            {/* Logo */}
            <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-6">
              <Wallet className="h-7 w-7 text-sidebar-primary" />
              <span className="text-xl font-bold text-sidebar-foreground">Smokzy</span>
            </div>

            {/* Accountant mode toggle */}
            {isAccountant && (
              <div className="border-b border-sidebar-border p-4">
                <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent p-2">
                  <Button
                    size="sm"
                    variant={!accountingMode ? 'secondary' : 'ghost'}
                    className={cn(
                      'flex-1 text-xs',
                      !accountingMode && 'bg-sidebar-primary text-sidebar-primary-foreground'
                    )}
                    onClick={() => setAccountingMode(false)}
                  >
                    <User className="mr-1 h-3 w-3" />
                    My Account
                  </Button>
                  <Button
                    size="sm"
                    variant={accountingMode ? 'secondary' : 'ghost'}
                    className={cn(
                      'flex-1 text-xs',
                      accountingMode && 'bg-sidebar-primary text-sidebar-primary-foreground'
                    )}
                    onClick={() => setAccountingMode(true)}
                  >
                    <Calculator className="mr-1 h-3 w-3" />
                    Accounting
                  </Button>
                </div>
              </div>
            )}

            {/* Navigation */}
            <ScrollArea className="flex-1 px-3 py-4">
              <nav className="space-y-1">
                {filteredNavItems.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.title}
                      {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
                    </Link>
                  );
                })}
              </nav>
            </ScrollArea>

            {/* User menu */}
            <div className="border-t border-sidebar-border p-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm">
                        {getInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate text-sm font-medium text-sidebar-foreground">
                        {displayName}
                      </p>
                      <p className="truncate text-xs text-sidebar-foreground/60">
                        {roleDisplay}
                      </p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 lg:pl-0">
          <div className="container max-w-7xl py-6 px-4 sm:px-6 lg:px-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
