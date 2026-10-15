"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { loginSchema, type LoginInput } from "@/features/auth/schemas/auth.schema";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { AuthCard, AuthField, AuthNotice, AUTH_INPUT, AUTH_SUBMIT, AUTH_LINK } from "./AuthShell";

export function LoginForm() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginInput) => {
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        ...data,
        redirect: false,
      });
      if (result?.error) {
        toast.error("Invalid email or password");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your account"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/register" className={AUTH_LINK} style={{ color: "var(--ink)" }}>
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <AuthField label="Email" htmlFor="login-form-email-1" error={errors.email?.message}>
          <Input
            id="login-form-email-1"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className={AUTH_INPUT}
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </AuthField>

        <AuthField label="Password" htmlFor="login-password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="login-password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              className={`${AUTH_INPUT} pr-12`}
              aria-invalid={!!errors.password}
              {...register("password")}
            />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 rounded-full"
                style={{ color: "var(--ink-3)" }}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
          </div>
          <div className="flex justify-end">
            <Link href="/forgot-password" className={`text-xs ${AUTH_LINK}`} style={{ color: "var(--ink-2)" }}>
              Forgot password?
            </Link>
          </div>
        </AuthField>

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
