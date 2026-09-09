"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  BarChart2,
  Wallet,
  Plus,
  Bell,
  Settings,
  KeyRound,
  PiggyBank,
  Target,
  HandCoins,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";

const NAV_COMMANDS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/loans", label: "Loans", icon: HandCoins },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/logs", label: "Logs", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Global cmd+k / ctrl+k quick-jump: navigate to any page, jump straight to
 * add-transaction, or find an account by name — all from the keyboard,
 * without hunting through the sidebar. Mounted once in the app shell. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: accounts } = useAccounts();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    // lets a visible trigger button (DesktopTopbar/MobileHeader) open the
    // same palette without lifting open-state through the layout tree
    const openHandler = () => setOpen(true);
    document.addEventListener("open-command-palette", openHandler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("open-command-palette", openHandler);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a page, add a transaction, find an account..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go("/transactions/add")}>
            <Plus />
            Add transaction
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Pages">
          {NAV_COMMANDS.map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} onSelect={() => go(href)}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        {accounts && accounts.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <CommandItem key={String(account._id)} onSelect={() => go(`/accounts/${account._id}`)}>
                  <Wallet />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
