"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff, Wallet } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/features/auth/schemas/auth.schema";
import apiClient from "@/lib/api-client";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Input } from "@/components/_ui/Input";
import { Label } from "@/components/ui/label";

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

  const fieldClass = "rounded-[14px] py-3 px-4 h-auto font-semibold";
  const fieldStyle = { background: "var(--card-2)", border: "1.5px solid var(--line-2)" };

  return (
    <Card radius="lg" elevation="floating" className="p-8">
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
        Create account
      </h1>
      <p className="text-sm font-medium mb-7" style={{ color: "var(--ink-2)" }}>
        Start tracking your finances
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div>
          <Label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
            Full name
          </Label>
          <Input
            type="text"
            autoComplete="name"
            placeholder="Alex Rivera"
            className={fieldClass}
            style={fieldStyle}
            {...register("name")}
          />
          {errors.name && (
            <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <Label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
            Email
          </Label>
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className={fieldClass}
            style={fieldStyle}
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
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              className={`${fieldClass} pr-12`}
              style={fieldStyle}
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

        <div>
          <Label className="block text-xs font-bold mb-2" style={{ color: "var(--ink-2)" }}>
            Confirm password
          </Label>
          <Input
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repeat password"
            className={fieldClass}
            style={fieldStyle}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs font-semibold" style={{ color: "var(--red)" }}>
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-auto py-4 rounded-[15px] font-bold text-base mt-1"
          style={{ background: "var(--fab)", color: "var(--fab-ink)" }}
        >
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-center mt-6 text-sm font-semibold" style={{ color: "var(--ink-2)" }}>
        Already have an account?{" "}
        <Link href="/login" className="font-bold" style={{ color: "var(--violet)" }}>
          Sign in
        </Link>
      </p>
    </Card>
  );
}
