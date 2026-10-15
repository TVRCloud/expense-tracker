"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { AuthCard, AuthField, AuthNotice, AUTH_INPUT, AUTH_SUBMIT, AUTH_LINK } from "./AuthShell";

export function RegisterForm() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (data: RegisterInput) => {
    setLoading(true);
    try {
      await apiClient.post("/auth/register", {
        name: data.name,
        email: data.email,
        password: data.password,
      });
      toast.success("Account created! Please sign in.");
      router.push("/login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      title="Create account"
      subtitle="Start tracking your finances"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={AUTH_LINK} style={{ color: "var(--ink)" }}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <AuthField label="Full name" htmlFor="register-form-full-name-1" error={errors.name?.message}>
          <Input
            id="register-form-full-name-1"
            type="text"
            autoComplete="name"
            placeholder="Alex Rivera"
            className={AUTH_INPUT}
            aria-invalid={!!errors.name}
            {...register("name")}
          />
        </AuthField>

        <AuthField label="Email" htmlFor="register-form-email-2" error={errors.email?.message}>
          <Input
            id="register-form-email-2"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className={AUTH_INPUT}
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </AuthField>

        <AuthField label="Password" htmlFor="register-password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="register-password"
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
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
        </AuthField>

        <AuthField label="Confirm password" htmlFor="register-confirm-password" error={errors.confirmPassword?.message}>
          <Input
            id="register-confirm-password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repeat password"
            className={AUTH_INPUT}
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </AuthField>

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
