"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Shield, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { RoleGuard } from "@/components/shared/RoleGuard";
import { Skeleton } from "@/components/ui/skeleton";
import { type IUser } from "@/types/models";

function useUsers(search: string) {
  return useQuery<{ data: IUser[]; total: number }>({
    queryKey: ["admin", "users", search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50", skip: "0" });
      if (search) params.set("search", search);
      const res = await apiClient.get<{ data: IUser[]; total: number }>(`/users?${params}`);
      return res.data;
    },
  });
}

export function AdminUsersClient() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useUsers(search);

  const updateUser = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<IUser> }) =>
      apiClient.patch(`/users/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("User updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const users = useMemo(() => data?.data ?? [], [data?.data]);

  return (
    <RoleGuard
      roles={["admin"]}
      fallback={
        <div className="rounded-[var(--r-lg)] p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <div className="font-bold" style={{ color: "var(--ink)" }}>Admin access required</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Your account does not have permission to manage users.</p>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] grid place-items-center" style={{ background: "rgba(0,0,0,.10)", color: "var(--violet)" }}>
            <Shield size={19} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold" style={{ color: "var(--ink)" }}>Users</h2>
            <div className="text-sm" style={{ color: "var(--ink-3)" }}>{data?.total ?? 0} total</div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-[var(--r-md)] px-4 py-3" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
          <Search size={18} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearch(searchInput.trim());
              if (e.key === "Escape") {
                setSearchInput("");
                setSearch("");
              }
            }}
            placeholder="Search users..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-3)] text-[var(--ink)]"
          />
          <button
            onClick={() => setSearch(searchInput.trim())}
            className="px-3 py-1.5 rounded-[var(--r-sm)] text-sm font-bold"
            style={{ background: "var(--violet)", color: "#fff" }}
          >
            Search
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--r-md)]" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="rounded-[var(--r-lg)] p-8 text-center" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
            <div className="font-bold" style={{ color: "var(--ink)" }}>No users found</div>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Try a different search.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {users.map((user) => (
              <div key={String(user._id)} className="rounded-[var(--r-md)] px-4 py-4 flex items-center gap-4" style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)" }}>
                <div className="w-11 h-11 rounded-[14px] grid place-items-center text-white font-bold flex-none" style={{ background: "linear-gradient(150deg,var(--violet),var(--violet-2))" }}>
                  {user.name?.[0]?.toUpperCase() ?? "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate" style={{ color: "var(--ink)" }}>{user.name}</div>
                  <div className="text-sm truncate" style={{ color: "var(--ink-3)" }}>{user.email}</div>
                </div>
                <select
                  value={user.role}
                  onChange={(e) => updateUser.mutate({ id: String(user._id), patch: { role: e.target.value as IUser["role"] } })}
                  className="rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold outline-none"
                  style={{ background: "var(--card-2)", color: "var(--ink)", border: "1px solid var(--line)" }}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => updateUser.mutate({ id: String(user._id), patch: { isActive: !user.isActive } })}
                  disabled={updateUser.isPending}
                  className="inline-flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold"
                  style={user.isActive ? { background: "rgba(79,192,126,.12)", color: "var(--green)" } : { background: "rgba(235,87,87,.12)", color: "var(--red)" }}
                >
                  {user.isActive ? <UserCheck size={15} /> : <UserX size={15} />}
                  {user.isActive ? "Active" : "Inactive"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
