"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { AuthCard, AuthField, AuthNotice, AUTH_INPUT, AUTH_SUBMIT, AUTH_LINK } from "./AuthShell";

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setLoading(true);
    try {
      await apiClient.post("/auth/forgot-password", data);
      setSent(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <AuthNotice icon={<Check size={26} />} title="Reset link sent">
          <p className="mt-2 mb-6" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            If that email is registered, a reset link was sent.
          </p>
          <Link href="/login" className={AUTH_LINK} style={{ color: "var(--ink)" }}>
            Back to sign in
          </Link>
        </AuthNotice>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset password"
      subtitle="Enter your email and we'll send a reset link."
      footer={
        <Link href="/login" className={`inline-flex items-center gap-2 ${AUTH_LINK}`} style={{ color: "var(--ink-2)" }}>
          <ArrowLeft size={16} /> Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <AuthField label="Email" htmlFor="forgot-password-form-email-1" error={errors.email?.message}>
          <Input
            id="forgot-password-form-email-1"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className={AUTH_INPUT}
            aria-invalid={!!errors.email}
            {...register("email")}
          />
        </AuthField>

        <Button type="submit" disabled={loading} className={AUTH_SUBMIT}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
