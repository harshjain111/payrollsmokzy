import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Wallet, Eye, EyeOff, Loader2, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
const phoneSchema = z.string().min(10, 'Please enter a valid phone number').max(15, 'Phone number too long');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');

// Convert phone to pseudo-email for Supabase auth
const phoneToEmail = (phone: string) => {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return `${cleanPhone}@phone.smokzy.internal`;
};
export default function Auth() {
  const navigate = useNavigate();
  const {
    user,
    signIn,
    isLoading: authLoading
  } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    return localStorage.getItem('rememberMe') === 'true';
  });

  // Login form
  const [loginPhone, setLoginPhone] = useState(() => {
    return rememberMe ? localStorage.getItem('savedPhone') || '' : '';
  });
  const [loginPassword, setLoginPassword] = useState('');
  useEffect(() => {
    if (user && !authLoading) {
      navigate('/dashboard');
    }
  }, [user, authLoading, navigate]);
  const formatPhoneInput = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    return digits;
  };
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = formatPhoneInput(loginPhone);
    try {
      phoneSchema.parse(cleanPhone);
      passwordSchema.parse(loginPassword);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }
    setIsLoading(true);
    const pseudoEmail = phoneToEmail(cleanPhone);
    const {
      error
    } = await signIn(pseudoEmail, loginPassword);
    setIsLoading(false);
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        toast.error('Invalid phone number or password');
      } else {
        toast.error(error.message);
      }
    } else {
      // Handle Remember Me
      if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
        localStorage.setItem('savedPhone', cleanPhone);
      } else {
        localStorage.removeItem('rememberMe');
        localStorage.removeItem('savedPhone');
      }
      toast.success('Welcome back!');
      navigate('/dashboard');
    }
  };
  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>;
  }
  return <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
              <Wallet className="h-6 w-6 text-white" />
            </div>
            <span className="text-3xl font-bold text-foreground">Smokzy</span>
          </div>
          <p className="text-muted-foreground">
            Internal Payroll & Accounting System
          </p>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="pb-4 text-center">
            <h2 className="text-xl font-semibold">Welcome Back</h2>
            <p className="text-sm text-muted-foreground">Sign in with your phone number</p>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-phone">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input id="login-phone" type="tel" placeholder="9876543210" value={loginPhone} onChange={e => setLoginPhone(formatPhoneInput(e.target.value))} required autoComplete="tel" className="pl-10" maxLength={15} />
                </div>
                <p className="text-xs text-muted-foreground">Enter your registered phone number</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input id="login-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required autoComplete="current-password" />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>

              {/* Remember Me */}
              <div className="flex items-center space-x-2">
                <Checkbox id="remember-me" checked={rememberMe} onCheckedChange={checked => setRememberMe(checked === true)} />
                <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer select-none">
                  Remember me
                </Label>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </> : 'Sign In'}
              </Button>

              <p className="text-xs text-center text-muted-foreground pt-2">
                Contact your administrator if you don't have an account
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">© 2026 Smokzy. All rights reserved.</p>
      </div>
    </div>;
}