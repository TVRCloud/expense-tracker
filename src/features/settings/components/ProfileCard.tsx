"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { useUpdateProfile } from "../hooks/useProfile";
import { type IUser } from "@/types/models";

interface Props {
  user: IUser;
}

export function ProfileCard({ user }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const { mutateAsync: update, isPending } = useUpdateProfile();

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleSave = async () => {
    if (name.trim() === user.name) {
      setEditing(false);
      return;
    }
    await update({ name: name.trim() });
    setEditing(false);
  };

  return (
    <div
      className="rounded-[var(--r-lg)] p-6 flex items-center gap-5"
      style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
    >
      {/* Avatar */}
      <div
        className="w-[72px] h-[72px] rounded-[22px] grid place-items-center text-white text-2xl font-extrabold flex-none"
        style={{
          background: user.avatar
            ? undefined
            : "linear-gradient(135deg, #6B46F5 0%, #8A6BFF 100%)",
        }}
      >
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar} alt={user.name} className="w-full h-full rounded-[22px] object-cover" />
        ) : (
          initials
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold outline-none min-w-0"
              style={{
                background: "var(--card-2)",
                color: "var(--ink)",
                border: "1.5px solid var(--violet)",
              }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <button onClick={() => void handleSave()} disabled={isPending}>
              <Check size={17} style={{ color: "var(--green)" }} />
            </button>
            <button onClick={() => { setEditing(false); setName(user.name); }}>
              <X size={17} style={{ color: "var(--ink-3)" }} />
            </button>
          </div>
        ) : (
          <div className="text-lg font-extrabold truncate" style={{ color: "var(--ink)" }}>
            {user.name}
          </div>
        )}
        <div className="text-sm font-medium mt-0.5 truncate" style={{ color: "var(--ink-3)" }}>
          {user.email}
        </div>
        <div
          className="mt-1.5 inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
          style={{ background: "var(--card-2)", color: "var(--violet)" }}
        >
          {user.role}
        </div>
      </div>

      {/* Edit button */}
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="w-10 h-10 rounded-[var(--r-sm)] grid place-items-center flex-none"
          style={{ background: "var(--card-2)" }}
        >
          <Pencil size={16} style={{ color: "var(--ink-2)" }} />
        </button>
      )}
    </div>
  );
}
