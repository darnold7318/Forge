import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";
import { UserProvider } from "@/lib/user-context";
import { UserSwitcher } from "@/components/user-switcher";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import LogWorkout from "@/pages/log-workout";
import Progress from "@/pages/progress";
import Coach from "@/pages/coach";
import VolumeTracker from "@/pages/volume-tracker";
import WorkoutTemplates from "@/pages/workout-templates";
import Exercises from "@/pages/exercises";
import TemplateEditor from "@/pages/template-editor";
import SchedulePage from "@/pages/schedule";
import RecoveryMap from "@/pages/recovery";
import Settings from "@/pages/settings";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/log" component={LogWorkout} />
      <Route path="/progress" component={Progress} />
      <Route path="/progress/:exerciseId" component={Progress} />
      <Route path="/coach" component={Coach} />
      <Route path="/volume" component={VolumeTracker} />
      <Route path="/templates" component={WorkoutTemplates} />
      <Route path="/exercises" component={Exercises} />
      <Route path="/templates/:id/edit" component={TemplateEditor} />
      <Route path="/schedule" component={SchedulePage} />
      <Route path="/recovery" component={RecoveryMap} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <ThemeProvider>
          <TooltipProvider>
            <Router hook={useHashLocation}>
              <SidebarProvider style={style as React.CSSProperties}>
                <div className="flex h-screen w-full">
                  <AppSidebar />
                  <div className="flex flex-col flex-1 min-w-0">
                    <header className="flex items-center justify-between gap-2 p-2 border-b h-14 shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <SidebarTrigger data-testid="button-sidebar-toggle" />
                        <div className="md:hidden">
                          <Logo />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <UserSwitcher />
                        <div className="md:hidden">
                          <ThemeToggle />
                        </div>
                      </div>
                    </header>
                    <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
                      <AppRouter />
                    </main>
                    <BottomNav />
                  </div>
                </div>
              </SidebarProvider>
            </Router>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}
