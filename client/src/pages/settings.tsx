import { useEffect, useState } from "react";
import { Sun, Moon, Check, Settings as SettingsIcon, CalendarDays, ListChecks, Download, DatabaseBackup, Loader2, Trash2, ShieldCheck, UserPlus, KeyRound, LogOut } from "lucide-react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";
import {
  themeColorIds,
  workoutSplitIds,
  workoutSplitLabels,
  type ThemeColorId,
  type WorkoutSplitId,
  type CustomWeeklySlot,
  type User,
} from "@shared/schema";

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// UI shows Mon–Sun left to right, but slots are stored keyed 0=Sun..6=Sat to match JS getDay().
const WEEKDAY_DOW = [1, 2, 3, 4, 5, 6, 0];

interface WorkoutTemplateLite {
  id: number;
  name: string;
}

interface ScheduleForTemplate {
  customWeeklyTemplate: string;
}

// Light-mode --primary HSL for each palette id, used to render swatches for
// colors that may not currently be active (can't rely on CSS vars for that).
const THEME_COLOR_SWATCHES: Record<ThemeColorId, { label: string; hsl: string }> = {
  green: { label: "Forge Green", hsl: "142 76% 36%" },
  blue: { label: "Electric Blue", hsl: "217 91% 48%" },
  orange: { label: "Ember Orange", hsl: "22 88% 48%" },
  purple: { label: "Voltage Purple", hsl: "262 75% 50%" },
  red: { label: "Crimson", hsl: "4 78% 46%" },
  teal: { label: "Cyan Teal", hsl: "187 75% 38%" },
};

const WORKOUT_SPLIT_DESCRIPTIONS: Record<WorkoutSplitId, string> = {
  ppl: "Train pushing, pulling, and leg movements on separate days.",
  upper_lower: "Alternate between upper body and lower body sessions.",
  full_body: "Hit every major muscle group in each session.",
  bro_split: "Dedicate each session to a single muscle group.",
  custom: "Build your own rotation using workout templates.",
};

type SlotDraft = { mode: "rest" | "template" | "label"; workoutTemplateId: number | null; label: string };

function slotToDraft(slot: CustomWeeklySlot): SlotDraft {
  if (!slot) return { mode: "rest", workoutTemplateId: null, label: "" };
  if (slot.workoutTemplateId != null) return { mode: "template", workoutTemplateId: slot.workoutTemplateId, label: slot.label ?? "" };
  return { mode: "label", workoutTemplateId: null, label: slot.label ?? "" };
}

function CustomTemplateBuilder() {
  const { toast } = useToast();

  const { data: schedule, isLoading: scheduleLoading } = useQuery<ScheduleForTemplate>({
    queryKey: ["/api/schedule"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/schedule");
      return res.json();
    },
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<WorkoutTemplateLite[]>({
    queryKey: ["/api/workout-templates"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/workout-templates");
      return res.json();
    },
  });

  // 7 drafts in Mon–Sun UI order (index 0=Mon..6=Sun).
  const [drafts, setDrafts] = useState<SlotDraft[]>(
    Array.from({ length: 7 }, () => ({ mode: "rest", workoutTemplateId: null, label: "" })),
  );
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    if (!schedule || loadedOnce) return;
    try {
      const slots: CustomWeeklySlot[] = JSON.parse(schedule.customWeeklyTemplate || "[null,null,null,null,null,null,null]");
      setDrafts(WEEKDAY_DOW.map((dow) => slotToDraft(slots[dow] ?? null)));
    } catch {
      // keep defaults
    }
    setLoadedOnce(true);
  }, [schedule, loadedOnce]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Convert Mon-Sun UI drafts back into 0=Sun..6=Sat storage order.
      const slots: (CustomWeeklySlot)[] = new Array(7).fill(null);
      WEEKDAY_DOW.forEach((dow, uiIdx) => {
        const d = drafts[uiIdx];
        if (d.mode === "rest") {
          slots[dow] = null;
        } else if (d.mode === "template") {
          const t = templates?.find((t) => t.id === d.workoutTemplateId);
          slots[dow] = { label: t?.name ?? null, workoutTemplateId: d.workoutTemplateId };
        } else {
          slots[dow] = { label: d.label.trim() || null, workoutTemplateId: null };
        }
      });
      const res = await apiRequest("PUT", "/api/schedule/custom-template", { slots });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      toast({ title: "Custom template saved" });
    },
    onError: () => toast({ title: "Couldn't save custom template", variant: "destructive" }),
  });

  const updateDraft = (idx: number, patch: Partial<SlotDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  if (scheduleLoading || templatesLoading) {
    return <Skeleton className="h-64 w-full" data-testid="skeleton-custom-template" />;
  }

  return (
    <Card data-testid="card-custom-template">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Custom Weekly Template
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Assign each day of the week once — it repeats identically every week, forever. Pick one of your saved
          templates, or just type a label (like "Push") and we'll build a starter workout for it automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {WEEKDAY_LABELS.map((name, idx) => {
          const draft = drafts[idx];
          return (
            <div
              key={name}
              className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border p-2.5"
              data-testid={`row-custom-template-${name.toLowerCase()}`}
            >
              <span className="text-sm font-medium w-20 shrink-0">{name}</span>
              <Select
                value={draft.mode}
                onValueChange={(v) => updateDraft(idx, { mode: v as SlotDraft["mode"] })}
              >
                <SelectTrigger className="sm:w-36 shrink-0" data-testid={`select-custom-mode-${name.toLowerCase()}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rest" data-testid={`option-custom-mode-rest-${name.toLowerCase()}`}>Rest</SelectItem>
                  <SelectItem value="template" data-testid={`option-custom-mode-template-${name.toLowerCase()}`}>Saved Template</SelectItem>
                  <SelectItem value="label" data-testid={`option-custom-mode-label-${name.toLowerCase()}`}>Custom Label</SelectItem>
                </SelectContent>
              </Select>
              {draft.mode === "template" && (
                <Select
                  value={draft.workoutTemplateId != null ? String(draft.workoutTemplateId) : undefined}
                  onValueChange={(v) => updateDraft(idx, { workoutTemplateId: Number(v) })}
                >
                  <SelectTrigger className="flex-1" data-testid={`select-custom-template-${name.toLowerCase()}`}>
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)} data-testid={`option-custom-template-${t.id}`}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {draft.mode === "label" && (
                <Input
                  value={draft.label}
                  onChange={(e) => updateDraft(idx, { label: e.target.value })}
                  placeholder="e.g. Push"
                  className="flex-1"
                  maxLength={40}
                  data-testid={`input-custom-label-${name.toLowerCase()}`}
                />
              )}
            </div>
          );
        })}
        <Button
          className="w-full gap-2"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="button-save-custom-template"
        >
          {saveMutation.isPending ? "Saving..." : "Save Custom Template"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving updates the template only. Go to the Schedule page and pick "Custom" under Change Split to apply it
          to your calendar.
        </p>
      </CardContent>
    </Card>
  );
}

// Triggers a browser download from a fetched Response's blob, honoring the
// filename the server set via Content-Disposition (falls back to a default).
async function downloadResponse(res: Response, fallbackFilename: string) {
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Every logged-in user can back up their own data. Admins additionally get
// a "download everyone" button in the Account Management card below.
function BackupExportCard() {
  const { activeUser } = useActiveUser();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const downloadOwn = async () => {
    if (!activeUser) return;
    setDownloading(true);
    try {
      const res = await apiRequest("GET", `/api/export/user/${activeUser.id}`);
      await downloadResponse(res, `forge-backup-${activeUser.name}.json`);
      toast({ title: "Backup downloaded" });
    } catch {
      toast({ title: "Couldn't create backup", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card data-testid="card-backup-export">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4" />
          Backup & Export
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Download your data as a JSON file you can keep somewhere safe — templates, logged workouts, sets,
          schedule, and body weight history.
        </p>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full gap-2"
          disabled={downloading}
          onClick={downloadOwn}
          data-testid="button-backup-own"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download my backup
        </Button>
      </CardContent>
    </Card>
  );
}

// Admin-only: create accounts, reset anyone's password, delete accounts, and
// download a full multi-profile backup. Hidden entirely for non-admins.
function AdminUserManagementCard() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const { data: users, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });

  const createUser = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users", { name: newName.trim(), password: newPassword });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: `Account "${newName.trim()}" created` });
      setAddOpen(false);
      setNewName("");
      setNewPassword("");
    },
    onError: (err: Error) => {
      toast({ title: err.message.includes("taken") ? "That name is already taken" : "Couldn't create account", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!resetTarget) throw new Error("No target");
      const res = await apiRequest("PATCH", `/api/users/${resetTarget.id}/password`, { password: resetPassword });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `Password reset for ${resetTarget?.name}` });
      setResetTarget(null);
      setResetPassword("");
    },
    onError: () => toast({ title: "Couldn't reset password", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/users/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: `${deleteTarget?.name ?? "Account"} deleted` });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: err.message.includes("only remaining") ? "Can't delete the only account" : "Couldn't delete account", variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const downloadAll = async () => {
    setDownloadingAll(true);
    try {
      const res = await apiRequest("GET", "/api/export/all");
      await downloadResponse(res, "forge-full-backup.json");
      toast({ title: "Full backup downloaded" });
    } catch {
      toast({ title: "Couldn't create backup", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  const canDelete = (users ?? []).length > 1;

  return (
    <Card data-testid="card-admin-user-management">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          Account Management
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Admin tools — add accounts, reset passwords, or remove accounts. Only you can see this section.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-2">
            {(users ?? []).map((u) => (
              <div
                key={u.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-2.5"
                data-testid={`row-admin-user-${u.id}`}
              >
                <div className="text-sm font-medium">
                  {u.name}
                  {u.isAdmin && <span className="ml-2 text-xs text-muted-foreground">(admin)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setResetTarget({ id: u.id, name: u.name });
                      setResetPassword("");
                    }}
                    data-testid={`button-reset-password-${u.id}`}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Reset password
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    disabled={!canDelete}
                    title={canDelete ? undefined : "Can't delete the only remaining account"}
                    onClick={() => setDeleteTarget({ id: u.id, name: u.name })}
                    data-testid={`button-delete-account-${u.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => {
            setNewName("");
            setNewPassword("");
            setAddOpen(true);
          }}
          data-testid="button-add-account"
        >
          <UserPlus className="h-4 w-4" />
          Add account
        </Button>

        <Button
          className="w-full gap-2"
          disabled={downloadingAll}
          onClick={downloadAll}
          data-testid="button-backup-all"
        >
          {downloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
          Download full backup (all accounts)
        </Button>
      </CardContent>

      {/* Add account dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-account">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Add account
            </DialogTitle>
            <DialogDescription>Create a new login for someone else to use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-account-name">Name</Label>
              <Input
                id="new-account-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Alex"
                data-testid="input-new-account-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-account-password">Temporary password</Label>
              <Input
                id="new-account-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 4 characters"
                data-testid="input-new-account-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createUser.mutate()}
              disabled={!newName.trim() || newPassword.length < 4 || createUser.isPending}
              data-testid="button-confirm-add-account"
            >
              {createUser.isPending ? "Creating..." : "Create account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={resetTarget != null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Reset password for {resetTarget?.name}
            </DialogTitle>
            <DialogDescription>Set a new password. Share it with them directly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-password-input">New password</Label>
            <Input
              id="reset-password-input"
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="At least 4 characters"
              data-testid="input-reset-password"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => resetPasswordMutation.mutate()}
              disabled={resetPassword.length < 4 || resetPasswordMutation.isPending}
              data-testid="button-confirm-reset-password"
            >
              {resetPasswordMutation.isPending ? "Saving..." : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete account confirmation */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes this account and everything tied to it — workout templates, logged workouts
              and sets, schedule, and body weight history. This can't be undone. Consider downloading a backup
              first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-account">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-account"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function Settings() {
  const { activeUser, activeUserId, isLoading, logout } = useActiveUser();
  const { theme, themeColor, setTheme } = useTheme();
  const { toast } = useToast();

  const [pendingSplit, setPendingSplit] = useState<WorkoutSplitId | null>(null);

  const updatePreferences = useMutation({
    mutationFn: async (prefs: Record<string, string>) => {
      if (activeUserId == null) throw new Error("No active user");
      const res = await apiRequest("PATCH", `/api/users/${activeUserId}/preferences`, prefs);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Preferences saved" });
    },
    onError: () => {
      toast({ title: "Couldn't save preference", variant: "destructive" });
    },
  });

  const generateSchedule = useMutation({
    mutationFn: async (split: Exclude<WorkoutSplitId, "custom">) => {
      const res = await apiRequest("POST", "/api/schedule/generate", { split });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schedule"] });
      toast({ title: "Calendar updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update calendar", variant: "destructive" });
    },
  });

  const handleSplitChange = (split: WorkoutSplitId) => {
    if (split === "custom") {
      updatePreferences.mutate({ workoutSplit: split });
      return;
    }
    setPendingSplit(split);
  };

  const confirmSplitChange = () => {
    if (!pendingSplit || pendingSplit === "custom") return;
    generateSchedule.mutate(pendingSplit);
    setPendingSplit(null);
  };

  if (isLoading || !activeUser) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-display font-bold" data-testid="text-page-title">
            Settings
          </h1>
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold flex items-center gap-2" data-testid="text-page-title">
            <SettingsIcon className="h-5 w-5" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-settings-subtitle">
            Preferences for {activeUser.name}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => logout()} data-testid="button-logout">
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </Button>
      </div>

      {/* Appearance — Mode */}
      <Card data-testid="card-appearance-mode">
        <CardHeader>
          <CardTitle className="text-base">Appearance — Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              className="flex-1 gap-2"
              onClick={() => setTheme("light", themeColor)}
              data-testid="button-mode-light"
            >
              <Sun className="h-4 w-4" />
              Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              className="flex-1 gap-2"
              onClick={() => setTheme("dark", themeColor)}
              data-testid="button-mode-dark"
            >
              <Moon className="h-4 w-4" />
              Dark
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance — Accent Color */}
      <Card data-testid="card-appearance-color">
        <CardHeader>
          <CardTitle className="text-base">Appearance — Accent Color</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            {themeColorIds.map((id) => {
              const swatch = THEME_COLOR_SWATCHES[id];
              const isSelected = themeColor === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={`${swatch.label} theme`}
                  onClick={() => setTheme(theme, id)}
                  className="flex flex-col items-center gap-1.5 group"
                  data-testid={`button-theme-color-${id}`}
                >
                  <span
                    className="relative flex h-10 w-10 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow"
                    style={{
                      background: `hsl(${swatch.hsl})`,
                      boxShadow: isSelected ? "0 0 0 2px hsl(var(--ring))" : undefined,
                    }}
                  >
                    {isSelected && <Check className="h-4 w-4 text-white drop-shadow" />}
                  </span>
                  <span className="text-[11px] text-muted-foreground text-center leading-tight">
                    {swatch.label}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Training — Workout Split */}
      <Card data-testid="card-workout-split">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Training — Workout Split</CardTitle>
          <Link href="/schedule">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" data-testid="link-view-schedule">
              <CalendarDays className="h-3.5 w-3.5" />
              View your schedule
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={activeUser.workoutSplit}
            onValueChange={(v) => handleSplitChange(v as WorkoutSplitId)}
            data-testid="radio-group-workout-split"
          >
            {workoutSplitIds.map((id: WorkoutSplitId) => (
              <label
                key={id}
                htmlFor={`split-${id}`}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover-elevate"
                data-testid={`option-workout-split-${id}`}
              >
                <RadioGroupItem value={id} id={`split-${id}`} className="mt-0.5" data-testid={`radio-workout-split-${id}`} />
                <div className="space-y-0.5">
                  <Label htmlFor={`split-${id}`} className="cursor-pointer">
                    {workoutSplitLabels[id]}
                  </Label>
                  <p className="text-xs text-muted-foreground">{WORKOUT_SPLIT_DESCRIPTIONS[id]}</p>
                </div>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {activeUser.workoutSplit === "custom" && <CustomTemplateBuilder />}

      <BackupExportCard />

      {activeUser.isAdmin && <AdminUserManagementCard />}

      <AlertDialog open={pendingSplit != null} onOpenChange={(open) => !open && setPendingSplit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {pendingSplit ? workoutSplitLabels[pendingSplit] : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will auto-fill your calendar with a repeating {pendingSplit ? workoutSplitLabels[pendingSplit] : ""}{" "}
              rotation going forward, continuing month after month. Any days you've already customized are left alone,
              and you can always drag days around afterward from the Schedule page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-split-change">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSplitChange} data-testid="button-confirm-split-change">
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
