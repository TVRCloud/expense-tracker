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
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";

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
    <Card radius="lg" elevation="floating" className="p-8">
      {/* Brand */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-[12px] grid place-items-center text-white shadow-[0_8px_18px_rgba(0,0,0,.34)]"
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
          <Label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
            Email
          </Label>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded-[14px] py-3 px-4 h-auto font-semibold"
            style={{ background: "var(--card-2)", border: "1.5px solid var(--line-2)" }}
            {...register("email")}
          />
          {errors.email && (
            <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
              {errors.email.message}
            </p>
          )}
        </div>

        <div>
          <Label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
            Password
          </Label>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="rounded-[14px] py-3 px-4 pr-12 h-auto font-semibold"
              style={{ background: "var(--card-2)", border: "1.5px solid var(--line-2)" }}
              {...register("password")}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
              style={{ color: "var(--ink-3)" }}
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </Button>
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

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-auto py-4 rounded-[15px] font-bold text-base mt-1"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center mt-6 text-sm font-semibold" style={{ color: "var(--ink-2)" }}>
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-bold" style={{ color: "var(--violet)" }}>
          Sign up
        </Link>
      </p>
    </Card>
  );
}
