import { LayoutDashboard, Dumbbell, LineChart, Sparkles } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Log", url: "/log", icon: Dumbbell },
  { title: "Progress", url: "/progress", icon: LineChart },
  { title: "Coach", url: "/coach", icon: Sparkles },
];

export function BottomNav() {
  const [location] = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card md:hidden"
      aria-label="Primary"
      data-testid="nav-bottom"
    >
      <div className="flex items-stretch">
        {items.map((item) => {
          const isActive = location === item.url;
          return (
            <Link
              key={item.title}
              href={item.url}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 min-h-14 text-xs hover-elevate active-elevate-2",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
              data-testid={`link-bottomnav-${item.title.toLowerCase()}`}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
