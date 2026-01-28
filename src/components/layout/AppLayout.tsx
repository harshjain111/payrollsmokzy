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
  Calculator,
  User,
  Wallet,
  Receipt,
  History,
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
    href: '/payments/new',
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
    roles: ['owner', 'ca', 'accountant'],
  },
  {
    title: 'Audit Log',
    href: '/audit-log',
    icon: History,
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
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-xl px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Wallet className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Smokzy
          </span>
        </div>
        <NotificationBell />
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-out lg:static lg:translate-x-0',
            'bg-gradient-to-b from-[hsl(243,75%,18%)] to-[hsl(243,75%,12%)]',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-full flex-col">
            {/* Logo */}
            <div className="flex h-20 items-center gap-3 px-6">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
                <Wallet className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-white">Smokzy</span>
                <p className="text-xs text-white/50">Payroll System</p>
              </div>
            </div>

            {/* Accountant mode toggle */}
            {isAccountant && (
              <div className="px-4 pb-4">
                <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'flex-1 text-xs rounded-lg h-9 transition-all',
                      !accountingMode 
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg' 
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    )}
                    onClick={() => setAccountingMode(false)}
                  >
                    <User className="mr-1.5 h-3.5 w-3.5" />
                    My Account
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'flex-1 text-xs rounded-lg h-9 transition-all',
                      accountingMode 
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg' 
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    )}
                    onClick={() => setAccountingMode(true)}
                  >
                    <Calculator className="mr-1.5 h-3.5 w-3.5" />
                    Accounting
                  </Button>
                </div>
              </div>
            )}

            {/* Navigation */}
            <ScrollArea className="flex-1 px-4 py-2">
              <nav className="space-y-1">
                {filteredNavItems.map((item) => {
                  const isActive = location.pathname === item.href || 
                    (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-white/10 text-white shadow-lg'
                          : 'text-white/60 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-amber-400 to-orange-500 rounded-r-full" />
                      )}
                      <div className={cn(
                        'p-2 rounded-lg transition-colors',
                        isActive 
                          ? 'bg-gradient-to-br from-amber-400/20 to-orange-500/20' 
                          : 'bg-white/5'
                      )}>
                        <item.icon className={cn(
                          'h-4 w-4',
                          isActive ? 'text-amber-400' : ''
                        )} />
                      </div>
                      <span>{item.title}</span>
                    </Link>
                  );
                })}
              </nav>
            </ScrollArea>

            {/* User menu */}
            <div className="p-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all hover:bg-white/5 group">
                    <Avatar className="h-10 w-10 border-2 border-white/20">
                      <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-sm font-medium">
                        {getInitials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate text-sm font-medium text-white">
                        {displayName}
                      </p>
                      <p className="truncate text-xs text-white/50">
                        {roleDisplay}
                      </p>
                    </div>
                    <Settings className="h-4 w-4 text-white/40 group-hover:text-white/60 transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="rounded-lg">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive rounded-lg">
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
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content */}
        <main className="flex-1 lg:pl-0">
          {/* Desktop header */}
          <header className="hidden lg:flex h-16 items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-8">
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {filteredNavItems.find(item => location.pathname.startsWith(item.href))?.title || 'Dashboard'}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <NotificationBell />
              <div className="h-8 w-px bg-border" />
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs font-medium">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium">{displayName}</p>
                  <p className="text-xs text-muted-foreground">{roleDisplay}</p>
                </div>
              </div>
            </div>
          </header>
          
          <div className="py-6 px-4 sm:px-6 lg:px-8 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
