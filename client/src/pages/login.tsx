import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dumbbell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

type Mode = "login" | "signup";

export default function Login() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const res = await apiRequest("POST", endpoint, { name: name.trim(), password });
      return (await res.json()) as User;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: Error) => {
      const msg = err.message.replace(/^\d+:\s*/, "");
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.message ?? "Something went wrong");
      } catch {
        setError(msg || "Something went wrong");
      }
    },
  });

  const canSubmit = name.trim().length > 0 && password.length > 0 && !submit.isPending;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Logo />
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Dumbbell className="h-4 w-4" />
            Hypertrophy training, logged and coached.
          </div>
        </div>

        <Card data-testid="card-auth">
          <CardHeader>
            <CardTitle data-testid="text-auth-title">{mode === "login" ? "Log in" : "Create account"}</CardTitle>
            <CardDescription data-testid="text-auth-subtitle">
              {mode === "login"
                ? "Enter your name and password to access your training data."
                : "Pick a name and password — this becomes your private training profile."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) submit.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="auth-name">Name</Label>
                <Input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Derek"
                  autoComplete="username"
                  autoFocus
                  data-testid="input-auth-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="auth-password">Password</Label>
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 4 characters"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  data-testid="input-auth-password"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive" data-testid="text-auth-error">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full gap-2" disabled={!canSubmit} data-testid="button-auth-submit">
                {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {mode === "login" ? "Log in" : "Create account"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                    data-testid="button-switch-to-signup"
                  >
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                    data-testid="button-switch-to-login"
                  >
                    Log in
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
