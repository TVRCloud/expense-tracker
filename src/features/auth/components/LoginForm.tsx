"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff, Wallet } from "lucide-react";
import { loginSchema, type LoginInput } from "@/features/auth/schemas/auth.schema";

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
    <div
      className="rounded-[var(--r-lg)] p-8 shadow-[var(--shadow)]"
      style={{ background: "var(--card)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-[12px] grid place-items-center text-white shadow-[0_8px_18px_rgba(107,70,245,.34)]"
          style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))" }}
        >
          <Wallet size={20} />
        </div>
        <span className="font-extrabold text-xl tracking-tight">
          exp<span style={{ color: "var(--violet)" }}>s</span>
        </span>
      </div>

      <h1 className="font-extrabold text-2xl tracking-tight mb-1" style={{ color: "var(--ink)" }}>
        Welcome back
      </h1>
      <p className="text-sm font-medium mb-7" style={{ color: "var(--ink-2)" }}>
        Sign in to your account
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <label
            className="block text-xs font-bold mb-2"
            style={{ color: "var(--ink-2)" }}
          >
            Email
          </label>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full px-4 py-3 rounded-[14px] text-sm font-semibold outline-none transition-all"
            style={{
              background: "var(--card-2)",
              border: "1.5px solid var(--line-2)",
              color: "var(--ink)",
            }}
            {...register("email")}
          />
          {errors.email && (
            <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <label
            className="block text-xs font-bold mb-2"
            style={{ color: "var(--ink-2)" }}
          >
            Password
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-4 py-3 pr-12 rounded-[14px] text-sm font-semibold outline-none transition-all"
              style={{
                background: "var(--card-2)",
                border: "1.5px solid var(--line-2)",
                color: "var(--ink)",
              }}
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

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-bold"
            style={{ color: "var(--violet)" }}
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 rounded-[15px] font-bold text-base mt-1 transition-all disabled:opacity-60"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center mt-6 text-sm font-semibold" style={{ color: "var(--ink-2)" }}>
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-bold" style={{ color: "var(--violet)" }}>
          Sign up
        </Link>
      </p>
    </div>
  );
}
