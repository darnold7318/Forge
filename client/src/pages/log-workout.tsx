import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveUser } from "@/lib/user-context";
import ClassicLogWorkout from "@/pages/classic-log-workout";
import GuidedWorkout from "@/pages/guided-workout";

export default function LogWorkout() {
  const { activeUser, isLoading } = useActiveUser();
  const [location] = useLocation();

  if (isLoading || !activeUser) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const hashQuery = window.location.hash.includes("?")
    ? window.location.hash.slice(window.location.hash.indexOf("?"))
    : "";
  const params = new URLSearchParams(window.location.search || hashQuery);
  const override = params.get("logger");
  const mode = override === "classic" || override === "guided"
    ? override
    : activeUser.workoutLoggingMode ?? "classic";

  // Reading location keeps the dispatcher responsive to same-route query
  // switches under wouter's hash location implementation.
  void location;
  return mode === "guided" ? <GuidedWorkout /> : <ClassicLogWorkout />;
}
