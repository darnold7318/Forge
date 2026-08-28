import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Dumbbell, Plus, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveUser } from "@/lib/user-context";
import { useToast } from "@/hooks/use-toast";
import { equipmentTypes, type Equipment, type EquipmentProfile, type EquipmentProfileInput } from "@shared/schema";

const EQUIPMENT_LABELS: Record<string, string> = { SmithMachine: "Smith Machine", PlateLoaded: "Plate Loaded" };
const labelFor = (equipment: string) => EQUIPMENT_LABELS[equipment] ?? equipment;

function EquipmentProfileFields({ value, onChange }: { value: EquipmentProfileInput; onChange: (value: EquipmentProfileInput) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>Profile name</Label><Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="e.g. Functional Trainer" /></div>
        <div className="space-y-1"><Label>Equipment category</Label><Select value={value.equipment} onValueChange={(equipment) => onChange({ ...value, equipment: equipment as Equipment })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{equipmentTypes.map((equipment) => <SelectItem key={equipment} value={equipment}>{labelFor(equipment)}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1"><Label className="text-[11px]">Minimum</Label><Input type="number" min={0} step="0.5" value={value.minWeight} onChange={(event) => onChange({ ...value, minWeight: Number(event.target.value) })} /></div>
        <div className="space-y-1"><Label className="text-[11px]">Maximum</Label><Input type="number" min={0} step="0.5" value={value.maxWeight} onChange={(event) => onChange({ ...value, maxWeight: Number(event.target.value) })} /></div>
        <div className="space-y-1"><Label className="text-[11px]">Increment</Label><Input type="number" min={0.01} step="0.5" value={value.weightIncrement} onChange={(event) => onChange({ ...value, weightIncrement: Number(event.target.value) })} /></div>
      </div>
    </div>
  );
}

function validProfile(value: EquipmentProfileInput): boolean {
  return value.name.trim().length > 0 && [value.minWeight, value.maxWeight, value.weightIncrement].every(Number.isFinite) && value.minWeight >= 0 && value.maxWeight >= value.minWeight && value.weightIncrement > 0;
}

function ProfileRow({ profile, canDelete, onDelete }: { profile: EquipmentProfile; canDelete: boolean; onDelete: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<EquipmentProfileInput>({ ...profile });
  useEffect(() => setDraft({ ...profile }), [profile]);
  const original = { name: profile.name, equipment: profile.equipment, minWeight: profile.minWeight, maxWeight: profile.maxWeight, weightIncrement: profile.weightIncrement };
  const changed = JSON.stringify(draft) !== JSON.stringify(original);
  const mutation = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/equipment-profiles/${profile.id}`, draft)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
      toast({ title: `${draft.name} saved` });
    },
    onError: () => toast({ title: "Couldn't save equipment profile", description: "Profile names must be unique.", variant: "destructive" }),
  });
  return (
    <div className="rounded-md border p-3 space-y-3" data-testid={`equipment-profile-${profile.id}`}>
      <EquipmentProfileFields value={draft} onChange={setDraft} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!changed || !validProfile(draft) || mutation.isPending} onClick={() => mutation.mutate()}><Save className="h-3.5 w-3.5" />Save</Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={!canDelete} onClick={onDelete} title={canDelete ? "Delete profile" : "Keep at least one profile in this category"}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
      </div>
    </div>
  );
}

export function EquipmentSettingsEditor() {
  const { activeUserId } = useActiveUser();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<EquipmentProfile | null>(null);
  const [newProfile, setNewProfile] = useState<EquipmentProfileInput>({ name: "", equipment: "Cable", minWeight: 0, maxWeight: 200, weightIncrement: 5 });
  const { data, isLoading } = useQuery<EquipmentProfile[]>({ queryKey: ["/api/equipment-profiles", activeUserId], queryFn: async () => (await apiRequest("GET", "/api/equipment-profiles")).json(), enabled: activeUserId != null });
  const countsByType = useMemo(() => new Map(equipmentTypes.map((equipment) => [equipment, (data ?? []).filter((profile) => profile.equipment === equipment).length])), [data]);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/equipment-profiles"] });
    queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
    queryClient.invalidateQueries({ queryKey: ["/api/coach/suggestions"] });
  };
  const createMutation = useMutation({ mutationFn: async () => (await apiRequest("POST", "/api/equipment-profiles", newProfile)).json(), onSuccess: () => { invalidate(); setCreateOpen(false); toast({ title: `${newProfile.name} created` }); }, onError: () => toast({ title: "Couldn't create equipment profile", description: "Profile names must be unique.", variant: "destructive" }) });
  const deleteMutation = useMutation({ mutationFn: async (id: number) => apiRequest("DELETE", `/api/equipment-profiles/${id}`), onSuccess: () => { invalidate(); setDeleting(null); toast({ title: "Equipment profile deleted" }); }, onError: () => toast({ title: "Couldn't delete equipment profile", variant: "destructive" }) });
  return (
    <Card data-testid="card-equipment-settings">
      <CardHeader className="flex flex-row items-start justify-between gap-3"><div><CardTitle className="text-base flex items-center gap-2"><Dumbbell className="h-4 w-4" />Equipment Profiles</CardTitle><p className="text-xs text-muted-foreground mt-1">Create separate stacks, towers, bars, or adjustable sets, then assign one to each exercise.</p></div><div className="flex gap-2"><Link href="/exercises"><Button size="sm" variant="outline">Assign exercises</Button></Link><Button size="sm" onClick={() => { setNewProfile({ name: "", equipment: "Cable", minWeight: 0, maxWeight: 200, weightIncrement: 5 }); setCreateOpen(true); }}><Plus className="h-3.5 w-3.5" />Add profile</Button></div></CardHeader>
      <CardContent>{isLoading ? <Skeleton className="h-40 w-full" /> : <div className="grid gap-3 md:grid-cols-2">{(data ?? []).map((profile) => <ProfileRow key={profile.id} profile={profile} canDelete={(countsByType.get(profile.equipment) ?? 0) > 1} onDelete={() => setDeleting(profile)} />)}</div>}</CardContent>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>New equipment profile</DialogTitle><DialogDescription>Name the exact stack, tower, or equipment set you use.</DialogDescription></DialogHeader><EquipmentProfileFields value={newProfile} onChange={setNewProfile} /><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={!validProfile(newProfile) || createMutation.isPending} onClick={() => createMutation.mutate()}>Create profile</Button></DialogFooter></DialogContent></Dialog>
      <AlertDialog open={deleting != null} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle><AlertDialogDescription>Exercises assigned to it will return to the default profile for that equipment category.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </Card>
  );
}
