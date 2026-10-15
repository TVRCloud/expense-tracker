"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { useUpdateProfile } from "../hooks/useProfile";
import { type IUser } from "@/types/models";
import { Card } from "@/components/_ui/Card";
import { Button } from "@/components/_ui/Button";
import { Avatar } from "@/components/_ui/Avatar";
import { Input } from "@/components/_ui/Input";

interface Props {
  user: IUser;
}

export function ProfileCard({ user }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const { mutateAsync: update, isPending } = useUpdateProfile();

  const handleSave = async () => {
    if (name.trim() === user.name) {
      setEditing(false);
      return;
    }
    await update({ name: name.trim() });
    setEditing(false);
  };

  return (
    <Card radius="lg" className="p-5 sm:p-6 flex items-center gap-4 sm:gap-5">
      <Avatar name={user.name} src={user.avatar ?? undefined} size={64} className="flex-none" />

      {/* Info */}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              className="flex-1 min-w-0"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <Button type="button" variant="ghost" size="icon" aria-label="Save name" onClick={() => void handleSave()} disabled={isPending}>
              <Check size={17} style={{ color: "var(--green)" }} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel edit"
              onClick={() => { setEditing(false); setName(user.name); }}
            >
              <X size={17} style={{ color: "var(--ink-3)" }} />
            </Button>
          </div>
        ) : (
          <div className="truncate" style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>
            {user.name}
          </div>
        )}
        <div className="mt-0.5 truncate" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          {user.email}
        </div>
        <div
          className="mt-2 inline-block text-[11px] font-semibold capitalize px-2.5 py-0.5 rounded-full"
          style={{ background: "var(--card-2)", color: "var(--violet)" }}
        >
          {user.role}
        </div>
      </div>

      {/* Edit button */}
      {!editing && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Edit name"
          onClick={() => setEditing(true)}
          className="size-10 rounded-full"
          style={{ background: "var(--card-2)" }}
        >
          <Pencil size={16} style={{ color: "var(--ink-2)" }} />
        </Button>
      )}
    </Card>
  );
}
