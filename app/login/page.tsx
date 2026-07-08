'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registrationSecret, setRegistrationSecret] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent, isLogin: boolean) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const body: Record<string, string> = { username, password };
      if (!isLogin) body.registrationSecret = registrationSecret;

      const res = await fetch('/api/auth', {
        method: isLogin ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isLogin ? 'Authentication failed' : 'Registration failed'));
      }

      // Server has already set the HttpOnly auth-token cookie via Set-Cookie.
      // Just navigate; the middleware will allow the dashboard load.
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              {error && (
                <div className="mb-4 p-3 text-sm border rounded-md border-red-500 bg-red-50 text-red-600">
                  {error}
                </div>
              )}
              <form onSubmit={(e) => handleSubmit(e, true)} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="username-login" className="text-sm font-medium">Username</label>
                  <Input
                    id="username-login"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="password-login" className="text-sm font-medium">Password</label>
                  <Input
                    id="password-login"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Signing in…' : 'Login'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              {error && (
                <div className="mb-4 p-3 text-sm border rounded-md border-red-500 bg-red-50 text-red-600">
                  {error}
                </div>
              )}
              <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="username-register" className="text-sm font-medium">Username</label>
                  <Input
                    id="username-register"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="password-register" className="text-sm font-medium">Password</label>
                  <Input
                    id="password-register"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="reg-secret" className="text-sm font-medium">Registration secret</label>
                  <Input
                    id="reg-secret"
                    type="password"
                    value={registrationSecret}
                    onChange={(e) => setRegistrationSecret(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Register'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
