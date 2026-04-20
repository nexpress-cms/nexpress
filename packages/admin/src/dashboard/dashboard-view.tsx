"use client";

import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileClock,
  FileText,
  FolderOpen,
  Image,
  Plus,
  Upload,
} from "lucide-react";

import { Button } from "../ui/button.js";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.js";
import { cn } from "../ui/utils.js";

type DashboardStats = {
  collections: Array<{ slug: string; label: string; count: number }>;
  recentActivity: Array<{
    id: string;
    collection: string;
    title: string;
    action: string;
    timestamp: string;
  }>;
  draftCount: number;
  mediaCount: number;
};

interface DashboardViewProps {
  stats: DashboardStats;
}

const formatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function DashboardView({ stats }: DashboardViewProps) {
  const router = useRouter();

  const totalContent = stats.collections.reduce(
    (sum, collection) => sum + collection.count,
    0,
  );

  const statCards = [
    {
      label: "Total Content",
      value: totalContent,
      helper: "Across all collections",
      icon: FileText,
    },
    {
      label: "Drafts",
      value: stats.draftCount,
      helper: "Awaiting review or publish",
      icon: FileClock,
    },
    {
      label: "Media",
      value: stats.mediaCount,
      helper: "Assets in the library",
      icon: Image,
    },
    {
      label: "Collections",
      value: stats.collections.length,
      helper: "Active content groups",
      icon: FolderOpen,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Admin overview
          </p>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Keep an eye on publishing flow, recent edits, and the most-used shortcuts.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={() => router.push("/admin/collections/posts/create") }>
            <Plus className="mr-2 h-4 w-4" />
            Create Post
          </Button>
          <Button variant="outline" onClick={() => router.push("/admin/media") }>
            <Upload className="mr-2 h-4 w-4" />
            Upload Media
          </Button>
          <Button variant="ghost" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              View Site
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, helper, icon: Icon }) => (
          <Card key={label} className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <div className="rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                {value.toLocaleString()}
              </div>
              <p className="text-sm text-muted-foreground">{helper}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recentActivity.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
                No recent activity yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/70">
                <div className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-4 border-b border-border/70 bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <span>Entry</span>
                  <span>Collection</span>
                  <span>Updated</span>
                </div>
                <div className="divide-y divide-border/70">
                  {stats.recentActivity.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[1.2fr_1fr_0.9fr] gap-4 px-4 py-4 text-sm"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium text-foreground">{item.title}</p>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {item.action}
                        </p>
                      </div>
                      <div className="flex items-center text-muted-foreground">
                        {item.collection}
                      </div>
                      <div className="flex items-center text-muted-foreground">
                        {formatTimestamp(item.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle>Collection pulse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.collections.map((collection, index) => (
              <div key={collection.slug} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {collection.label}
                    </p>
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      {collection.slug}
                    </p>
                  </div>
                  <span className="font-semibold text-foreground">
                    {collection.count.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full bg-foreground/80 transition-all",
                      index % 2 === 0 && "bg-primary",
                    )}
                    style={{
                      width: `${Math.max(
                        10,
                        totalContent > 0
                          ? (collection.count / totalContent) * 100
                          : 18,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
          <CardFooter className="text-sm text-muted-foreground">
            Use these counts to spot where editors are spending time.
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return formatter.format(parsed);
}
