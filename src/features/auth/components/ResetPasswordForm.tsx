"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff, Check } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { AuthCard, AuthField, AuthNotice, AUTH_INPUT, AUTH_SUBMIT, AUTH_LINK } from "./AuthShell";

interface Props {
  token: string;
}

export function ResetPasswordForm({ token }: Props) {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = async (data: ResetPasswordInput) => {
    setLoading(true);
    try {
      await apiClient.post("/auth/reset-password", { token, password: data.password });
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="All set">
        <AuthNotice icon={<Check size={26} />} title="Password updated">
          <p className="mt-2" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            Redirecting you to sign in…
          </p>
        </AuthNotice>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="New password"
      subtitle="Choose a strong password for your account."
      footer={
        <Link href="/login" className={AUTH_LINK} style={{ color: "var(--ink-2)" }}>
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <AuthField label="New password" htmlFor="reset-password" error={errors.password?.message}>
          <div className="relative">
            <Input
              id="reset-password"
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

        <AuthField label="Confirm password" htmlFor="reset-confirm-password" error={errors.confirmPassword?.message}>
          <Input
            id="reset-confirm-password"
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repeat password"
            className={AUTH_INPUT}
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </AuthField>

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}
