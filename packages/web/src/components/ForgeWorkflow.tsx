"use client";

import { useState, useEffect } from "react";
import type { DashboardForgeContext } from "@/lib/types";

interface ForgeDebate {
  id: string;
  planId: string;
  name: string;
  projectId: string;
  state: "pending" | "running" | "paused" | "completed" | "failed";
  currentPhase: string | null;
  currentRound: number;
  maxRounds: number;
  roles: Array<{
    name: string;
    sessionId: string | null;
    status: "pending" | "running" | "completed" | "failed";
  }>;
  phases: Array<{
    name: string;
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: string;
    completedAt?: string;
  }>;
  outputFile: string | null;
  planPath: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error?: string;
}

interface ForgeWorkflowProps {
  sessions: Array<{
    id: string;
    forge?: DashboardForgeContext;
  }>;
}

export function ForgeWorkflow({ sessions }: ForgeWorkflowProps) {
  const [debates, setDebates] = useState<ForgeDebate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collect unique debate IDs from sessions
  const debateIds = sessions
    .filter((s): s is typeof s & { forge: DashboardForgeContext } => !!s.forge)
    .map((s) => s.forge.debateId);
  const uniqueDebateIds = [...new Set(debateIds)];

  useEffect(() => {
    async function fetchDebates() {
      if (uniqueDebateIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/forge/debates");
        if (!response.ok) {
          throw new Error("Failed to fetch debates");
        }
        const data = (await response.json()) as ForgeDebate[];
        // Filter to only debates that have sessions
        const relevantDebates = data.filter((d) => uniqueDebateIds.includes(d.id));
        setDebates(relevantDebates);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    fetchDebates();
    // Refresh every 10 seconds
    const interval = setInterval(fetchDebates, 10000);
    return () => clearInterval(interval);
  }, [uniqueDebateIds.join(",")]);

  if (uniqueDebateIds.length === 0) return null;
  if (loading) return <div className="py-4 text-[13px] text-[var(--color-text-muted)]">Loading FORGE debates...</div>;
  if (error) return <div className="py-4 text-[13px] text-red-500">Error: {error}</div>;
  if (debates.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-3 px-1 text-[10px] font-bold uppercase tracking-[0.10em] text-[var(--color-text-tertiary)]">
        FORGE Debates
      </h2>
      <div className="space-y-3">
        {debates.map((debate) => (
          <DebateCard key={debate.id} debate={debate} sessions={sessions} />
        ))}
      </div>
    </div>
  );
}

interface DebateCardProps {
  debate: ForgeDebate;
  sessions: Array<{
    id: string;
    forge?: DashboardForgeContext;
  }>;
}

function DebateCard({ debate, sessions }: DebateCardProps) {
  const stateColors: Record<string, string> = {
    pending: "var(--color-status-attention)",
    running: "var(--color-status-working)",
    paused: "var(--color-status-attention)",
    completed: "var(--color-status-success)",
    failed: "var(--color-status-error)",
  };

  const runningRoles = debate.roles.filter((r) => r.status === "running").length;
  const completedRoles = debate.roles.filter((r) => r.status === "completed").length;
  const failedRoles = debate.roles.filter((r) => r.status === "failed").length;

  // Get sessions for this debate
  const debateSessions = sessions.filter(
    (s) => s.forge?.debateId === debate.id
  );

  return (
    <div className="overflow-hidden rounded-[6px] border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: stateColors[debate.state] }}
          />
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {debate.name}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {debate.id.slice(0, 16)}...
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-[var(--color-text-muted)]">
          <span>
            Phase {debate.phases.findIndex((p) => p.name === debate.currentPhase) + 1} of {debate.phases.length}
          </span>
          <span>Round {debate.currentRound}/{debate.maxRounds}</span>
        </div>
      </div>

      <div className="px-4 py-3">
        {/* Progress bar */}
        <div className="mb-4">
          <div className="mb-1 flex justify-between text-[11px] text-[var(--color-text-muted)]">
            <span>Progress</span>
            <span>{completedRoles}/{debate.roles.length} roles complete</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border-muted)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
              style={{
                width: `${(completedRoles / debate.roles.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Phases */}
        <div className="mb-4 flex gap-1">
          {debate.phases.map((phase, idx) => {
            const isCurrent = phase.name === debate.currentPhase;
            const isCompleted = phase.status === "completed";
            const isPending = phase.status === "pending";

            return (
              <div
                key={phase.name}
                className={`flex-1 rounded px-2 py-1.5 text-center text-[10px] ${
                  isCompleted
                    ? "bg-green-500/10 text-green-600"
                    : isCurrent
                      ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                      : "bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)]"
                }`}
              >
                {idx + 1}. {phase.name}
              </div>
            );
          })}
        </div>

        {/* Roles */}
        <div className="grid grid-cols-2 gap-2">
          {debate.roles.map((role) => {
            const session = debateSessions.find((s) => s.forge?.role === role.name);
            const statusColors: Record<string, string> = {
              pending: "var(--color-status-attention)",
              running: "var(--color-status-working)",
              completed: "var(--color-status-success)",
              failed: "var(--color-status-error)",
            };

            return (
              <a
                key={role.name}
                href={session ? `/sessions/${encodeURIComponent(session.id)}` : undefined}
                className={`flex items-center justify-between rounded border border-[var(--color-border-subtle)] px-3 py-2 text-[11px] ${
                  session ? "hover:border-[var(--color-accent)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: statusColors[role.status] }}
                  />
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {role.name}
                  </span>
                </div>
                {role.sessionId && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {role.sessionId}
                  </span>
                )}
              </a>
            );
          })}
        </div>

        {debate.error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            {debate.error}
          </div>
        )}
      </div>
    </div>
  );
}
