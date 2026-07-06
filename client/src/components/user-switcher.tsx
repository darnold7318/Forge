import { useState } from "react";
import { Check, ChevronDown, Plus, Pencil, UserRound } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import type { User } from "@shared/schema";

// Rotating accent colors for profile badges, keyed by the user's stored
// colorAccent token (falls back to a stable hash of the id if unset).
const ACCENT_CLASSES: Record<string, string> = {
  "chart-1": "bg-[hsl(var(--chart-1))] text-white",
  "chart-4": "bg-[hsl(var(--chart-4))] text-white",
  "chart-5": "bg-[hsl(var(--chart-5))] text-white",
};
const FALLBACK_ACCENTS = ["chart-1", "chart-4", "chart-5"];

function accentClassFor(user: User, index: number): string {
  const key = user.colorAccent && ACCENT_CLASSES[user.colorAccent]
    ? user.colorAccent
    : FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
  return ACCENT_CLASSES[key];
}

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function UserSwitcher() {
  const { users, activeUser, activeUserId, setActiveUserId } = useActiveUser();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const createUser = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/users", { name });
      return (await res.json()) as User;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setActiveUserId(created.id);
      setAddOpen(false);
      setNameInput("");
      toast({ title: `Profile "${created.name}" created` });
    },
    onError: () => {
      toast({ title: "Couldn't create profile", variant: "destructive" });
    },
  });

  const renameUser = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, { name });
      return (await res.json()) as User;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setRenameOpen(false);
      toast({ title: `Renamed to "${updated.name}"` });
    },
    onError: () => {
      toast({ title: "Couldn't rename profile", variant: "destructive" });
    },
  });

  if (!activeUser) {
    return (
      <div className="h-8 w-8 rounded-full bg-muted animate-pulse" data-testid="status-user-switcher-loading" />
    );
  }

  const activeIndex = users.findIndex((u) => u.id === activeUserId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 pl-1.5 pr-2 rounded-full"
            data-testid="button-user-switcher"
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${accentClassFor(activeUser, activeIndex)}`}
              data-testid="badge-active-user-initial"
            >
              {initialFor(activeUser.name)}
            </span>
            <span className="hidden sm:inline text-xs font-medium max-w-[6rem] truncate" data-testid="text-active-user-name">
              {activeUser.name}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Switch profile</DropdownMenuLabel>
          {users.map((u, i) => (
            <DropdownMenuItem
              key={u.id}
              onClick={() => setActiveUserId(u.id)}
              className="gap-2"
              data-testid={`option-user-${u.id}`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${accentClassFor(u, i)}`}
              >
                {initialFor(u.name)}
              </span>
              <span className="flex-1 truncate">{u.name}</span>
              {u.id === activeUserId && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setNameInput("");
              setAddOpen(true);
            }}
            className="gap-2"
            data-testid="button-add-profile"
          >
            <Plus className="h-4 w-4" />
            Add profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setNameInput(activeUser.name);
              setRenameOpen(true);
            }}
            className="gap-2"
            data-testid="button-rename-profile"
          >
            <Pencil className="h-4 w-4" />
            Rename "{activeUser.name}"
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-profile">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRound className="h-4 w-4" /> Add profile
            </DialogTitle>
            <DialogDescription>
              Create a new profile to track separate workout data on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-profile-name">Name</Label>
            <Input
              id="new-profile-name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
              data-testid="input-new-profile-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameInput.trim()) createUser.mutate(nameInput.trim());
              }}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => createUser.mutate(nameInput.trim())}
              disabled={!nameInput.trim() || createUser.isPending}
              data-testid="button-confirm-add-profile"
            >
              {createUser.isPending ? "Creating..." : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent data-testid="dialog-rename-profile">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Rename profile
            </DialogTitle>
            <DialogDescription>Update the display name for this profile.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-profile-name">Name</Label>
            <Input
              id="rename-profile-name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              data-testid="input-rename-profile-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameInput.trim() && activeUser) {
                  renameUser.mutate({ id: activeUser.id, name: nameInput.trim() });
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => activeUser && renameUser.mutate({ id: activeUser.id, name: nameInput.trim() })}
              disabled={!nameInput.trim() || renameUser.isPending}
              data-testid="button-confirm-rename-profile"
            >
              {renameUser.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
