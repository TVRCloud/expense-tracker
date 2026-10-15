"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Search, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { RoleGuard } from "@/components/shared/RoleGuard";
import { Skeleton } from "@/components/_ui/Skeleton";
import { Card } from "@/components/_ui/Card";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";
import { Input } from "@/components/_ui/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { type IUser } from "@/types/models";

const PAGE_SIZE = 20;

function useUsers(search: string, skip: number) {
  return useQuery<{ data: IUser[]; total: number }>({
    queryKey: ["admin", "users", search, skip],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), skip: String(skip) });
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
  const [skip, setSkip] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data, isLoading } = useUsers(search, skip);

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
  const total = data?.total ?? 0;
  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = useMemo<ColumnDef<IUser>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 font-bold"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          User
          <ArrowUpDown size={13} className="ml-1.5" />
        </Button>
      ),
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={user.name ?? user.email} size={38} />
            <div className="min-w-0">
              <div className="font-bold truncate" style={{ color: "var(--ink)" }}>{user.name}</div>
              <div className="text-sm truncate" style={{ color: "var(--ink-3)" }}>{user.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Select
            value={user.role}
            onValueChange={(value) => updateUser.mutate({ id: String(user._id), patch: { role: value as IUser["role"] } })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Button
            type="button"
            variant="ghost"
            onClick={() => updateUser.mutate({ id: String(user._id), patch: { isActive: !user.isActive } })}
            disabled={updateUser.isPending}
            className="h-auto inline-flex items-center gap-2 rounded-full px-3.5 py-2 font-semibold"
            style={user.isActive ? { background: "color-mix(in srgb, var(--green) 13%, transparent)", color: "var(--green)" } : { background: "color-mix(in srgb, var(--red) 13%, transparent)", color: "var(--red)" }}
          >
            {user.isActive ? <UserCheck size={15} /> : <UserX size={15} />}
            {user.isActive ? "Active" : "Inactive"}
          </Button>
        );
      },
    },
  ], [updateUser]);

  const table = useReactTable({
    data: users,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <RoleGuard
      roles={["admin"]}
      fallback={
        <Card radius="lg" className="p-8 text-center">
          <div className="font-bold" style={{ color: "var(--ink)" }}>Admin access required</div>
          <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Your account does not have permission to manage users.</p>
        </Card>
      }
    >
      <div className="page-stack">
        <PageHeader title="Users" subtitle={`${total} total`} />

        <div className="chrome sticky z-10 flex items-center gap-3 rounded-(--r-md) px-4 min-h-12" style={{ top: "calc(var(--topbar-h) + 8px)", boxShadow: "var(--shadow-sm)" }}>
          <Search size={18} style={{ color: "var(--ink-3)", flexShrink: 0 }} aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { setSearch(searchInput.trim()); setSkip(0); }
              if (e.key === "Escape") {
                setSearchInput("");
                setSearch("");
                setSkip(0);
              }
            }}
            placeholder="Search by name or email"
            aria-label="Search users"
            className="flex-1 h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            type="button"
            onClick={() => { setSearch(searchInput.trim()); setSkip(0); }}
            className="h-auto px-4 py-1.5 rounded-full font-semibold"
          >
            Search
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-(--r-md)" />)}
          </div>
        ) : users.length === 0 ? (
          <Card radius="lg" className="p-8 text-center">
            <div className="font-bold" style={{ color: "var(--ink)" }}>No users found</div>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Try a different search.</p>
          </Card>
        ) : (
          <>
          <div className="inset-group md:hidden" style={{ "--inset": "66px" } as React.CSSProperties}>
            {users.map((user) => (
              <div key={String(user._id)} className="flex flex-col gap-3 px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={user.name ?? user.email} size={38} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate" style={{ color: "var(--ink)" }}>{user.name}</div>
                    <div className="text-sm truncate" style={{ color: "var(--ink-3)" }}>{user.email}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 pl-[50px]">
                  <Select
                    value={user.role}
                    onValueChange={(value) => updateUser.mutate({ id: String(user._id), patch: { role: value as IUser["role"] } })}
                  >
                    <SelectTrigger className="w-28 pointer-coarse:min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateUser.mutate({ id: String(user._id), patch: { isActive: !user.isActive } })}
                    disabled={updateUser.isPending}
                    className="h-auto inline-flex items-center gap-2 rounded-full px-3.5 py-2 font-semibold"
                    style={user.isActive ? { background: "color-mix(in srgb, var(--green) 13%, transparent)", color: "var(--green)" } : { background: "color-mix(in srgb, var(--red) 13%, transparent)", color: "var(--red)" }}
                  >
                    {user.isActive ? <UserCheck size={15} /> : <UserX size={15} />}
                    {user.isActive ? "Active" : "Inactive"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Card radius="lg" className="hidden md:block overflow-hidden p-1">
            <Table>
              <TableHeader className="sticky top-0">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          </>
        )}

        {pageCount > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={page <= 1}
                  className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                  onClick={(e) => { e.preventDefault(); if (page > 1) setSkip((page - 2) * PAGE_SIZE); }}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="text-sm font-medium px-2" style={{ color: "var(--ink-2)" }}>
                  Page {page} of {pageCount}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={page >= pageCount}
                  className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
                  onClick={(e) => { e.preventDefault(); if (page < pageCount) setSkip(page * PAGE_SIZE); }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>
    </RoleGuard>
  );
}
