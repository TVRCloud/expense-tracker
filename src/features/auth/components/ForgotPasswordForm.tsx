"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import Link from "next/link";
import { Wallet, ArrowLeft, CheckCircle } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";

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

  return (
    <div
      className="rounded-[var(--r-lg)] p-8 shadow-[var(--shadow)]"
      style={{ background: "var(--card)" }}
    >
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-[12px] grid place-items-center text-white"
          style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))" }}
        >
          <Wallet size={20} />
        </div>
        <span className="font-extrabold text-xl tracking-tight">
          exp<span style={{ color: "var(--violet)" }}>s</span>
        </span>
      </div>

      {sent ? (
        <div className="text-center py-4">
          <CheckCircle size={48} className="mx-auto mb-4" style={{ color: "var(--green)" }} />
          <h2 className="font-extrabold text-xl mb-2" style={{ color: "var(--ink)" }}>
            Check your email
          </h2>
          <p className="text-sm font-medium mb-6" style={{ color: "var(--ink-2)" }}>
            If that email is registered, a reset link was sent.
          </p>
          <Link
            href="/login"
            className="font-bold text-sm"
            style={{ color: "var(--violet)" }}
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h1 className="font-extrabold text-2xl tracking-tight mb-1" style={{ color: "var(--ink)" }}>
            Reset password
          </h1>
          <p className="text-sm font-medium mb-7" style={{ color: "var(--ink-2)" }}>
            Enter your email and we&apos;ll send a reset link.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-[14px] text-sm font-semibold outline-none"
                style={{ background: "var(--card-2)", border: "1.5px solid var(--line-2)", color: "var(--ink)" }}
                {...register("email")}
              />
              {errors.email && (
                <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
                  {errors.email.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-[15px] font-bold text-base mt-1 disabled:opacity-60"
              style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>

          <div className="mt-6 flex justify-center">
            <Link
              href="/login"
              className="flex items-center gap-2 text-sm font-bold"
              style={{ color: "var(--ink-2)" }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
