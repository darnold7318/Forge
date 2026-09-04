import { useEffect } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveUser } from "@/lib/user-context";
import ClassicLogWorkout from "@/pages/classic-log-workout";
import GuidedWorkout from "@/pages/guided-workout";

export default function LogWorkout() {
  const { activeUser, isLoading } = useActiveUser();
  const [location] = useLocation();

  // Older Guided builds used ?logger=classic as a temporary override. Under
  // the hash router that query lives on the real URL and survives unrelated
  // navigation, so it could permanently mask a later Guided preference.
  // Remove the obsolete parameter while preserving other query values (such
  // as a requested template); the saved per-user preference is authoritative.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("logger")) return;
    url.searchParams.delete("logger");
    window.history.replaceState(window.history.state, "", url);
  }, [location]);

  if (isLoading || !activeUser) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const mode = activeUser.workoutLoggingMode ?? "classic";
  return mode === "guided" ? <GuidedWorkout /> : <ClassicLogWorkout />;
}
