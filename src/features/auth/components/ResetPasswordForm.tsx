"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff, Wallet, CheckCircle } from "lucide-react";
import { resetPasswordSchema, type ResetPasswordInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";

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

      {done ? (
        <div className="text-center py-4">
          <CheckCircle size={48} className="mx-auto mb-4" style={{ color: "var(--green)" }} />
          <h2 className="font-extrabold text-xl mb-2" style={{ color: "var(--ink)" }}>
            Password updated!
          </h2>
          <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>
            Redirecting you to sign in…
          </p>
        </div>
      ) : (
        <>
          <h1 className="font-extrabold text-2xl tracking-tight mb-1" style={{ color: "var(--ink)" }}>
            New password
          </h1>
          <p className="text-sm font-medium mb-7" style={{ color: "var(--ink-2)" }}>
            Choose a strong password for your account.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
                New password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
                  className="w-full px-4 py-3 pr-12 rounded-[14px] text-sm font-semibold outline-none"
                  style={{ background: "var(--card-2)", border: "1.5px solid var(--line-2)", color: "var(--ink)" }}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: "var(--ink-3)" }}
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
                  {errors.password.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
                Confirm password
              </label>
              <input
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repeat password"
                className="w-full px-4 py-3 rounded-[14px] text-sm font-semibold outline-none"
                style={{ background: "var(--card-2)", border: "1.5px solid var(--line-2)", color: "var(--ink)" }}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-[15px] font-bold text-base mt-1 disabled:opacity-60"
              style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>

          <div className="mt-6 flex justify-center">
            <Link href="/login" className="text-sm font-bold" style={{ color: "var(--ink-2)" }}>
              Back to sign in
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
