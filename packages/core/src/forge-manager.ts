/**
 * FORGE Manager — Multi-Agent Debate System
 *
 * Orchestrates structured debates between multiple AI agents,
 * each taking on a specific role to collaboratively solve complex problems.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type {
  ForgeManager,
  Debate,
  DebatePlan,
  DebateStatus,
  DebateRole,
  DebatePhase,
  SessionManager,
  OrchestratorConfig,
  ProjectConfig,
} from "./types.js";
import { getSessionsDir, getProjectBaseDir } from "./paths.js";
import { writeMetadata, readMetadataRaw, listMetadata, deleteMetadata } from "./metadata.js";

/** Bootstrap FORGE workspace structure */
async function bootstrapForgeWorkspace(projectPath: string, planPath: string): Promise<void> {
  const forgeDir = join(projectPath, ".claude", "forge");
  const knowledgeDir = join(forgeDir, "knowledge");
  const phasesDir = join(projectPath, "docs", "forge", "phases");
  const handoffsDir = join(projectPath, "docs", "forge", "handoffs");
  const debateDir = join(projectPath, "docs", "forge", "debate");

  // Create directory structure
  for (const dir of [forgeDir, knowledgeDir, phasesDir, handoffsDir, debateDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create knowledge template files if they don't exist
  const knowledgeFiles = [
    { name: "brief.md", title: "Project Brief", content: "# Project Brief\n\n<!-- PRD content will be loaded here -->\n" },
    { name: "assumptions.md", title: "Assumptions", content: "# Assumptions\n\n| ID | Assumption | Status | Date |\n|----|------------|--------|------|\n" },
    { name: "decisions.md", title: "Decisions", content: "# Decisions\n\n| ID | Decision | Rationale | Date | Supersedes |\n|----|----------|-----------|------|------------|\n" },
    { name: "constraints.md", title: "Constraints", content: "# Constraints\n\n| ID | Constraint | Source |\n|----|------------|--------|\n" },
    { name: "risks.md", title: "Risks", content: "# Risks\n\n| ID | Risk | Severity | Mitigation | Owner |\n|----|------|----------|------------|-------|\n" },
    { name: "glossary.md", title: "Glossary", content: "# Glossary\n\n| Term | Definition | Context |\n|------|------------|---------|\n" },
    { name: "traceability.md", title: "Traceability", content: "# Traceability Matrix\n\n| Req ID | Source | Implementation | Test | Status |\n|--------|--------|----------------|------|--------|\n" },
  ];

  for (const file of knowledgeFiles) {
    const filePath = join(knowledgeDir, file.name);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, file.content, "utf-8");
    }
  }

  // Copy PRD to brief.md if plan exists and brief is empty/template
  const briefPath = join(knowledgeDir, "brief.md");
  if (existsSync(planPath) && existsSync(briefPath)) {
    const briefContent = readFileSync(briefPath, "utf-8");
    if (briefContent.includes("<!-- PRD content will be loaded here -->")) {
      const planContent = readFileSync(planPath, "utf-8");
      writeFileSync(briefPath, `# Project Brief\n\nGenerated from debate plan.\n\n---\n\n${planContent}`, "utf-8");
    }
  }
}

/** FORGE metadata stored in session files */
interface ForgeMetadata {
  debateId: string;
  role: string;
  phase: string;
  planPath: string;
}

/** Dependencies for creating a ForgeManager */
export interface ForgeManagerDeps {
  config: OrchestratorConfig;
  sessionManager: SessionManager;
}

/** Load a debate plan from a YAML file */
function loadDebatePlan(planPath: string): DebatePlan {
  if (!existsSync(planPath)) {
    throw new Error(`Debate plan not found: ${planPath}`);
  }

  const content = readFileSync(planPath, "utf-8");
  const raw = parseYaml(content) as Record<string, unknown>;

  // Validate required fields
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(`Debate plan missing required field: name`);
  }
  if (!raw.problem || typeof raw.problem !== "string") {
    throw new Error(`Debate plan missing required field: problem`);
  }
  if (!raw.roles || !Array.isArray(raw.roles)) {
    throw new Error(`Debate plan missing required field: roles`);
  }
  if (!raw.phases || !Array.isArray(raw.phases)) {
    throw new Error(`Debate plan missing required field: phases`);
  }

  const id = (raw.id as string) || randomUUID();

  return {
    id,
    name: raw.name as string,
    description: (raw.description as string) || "",
    problem: raw.problem as string,
    projectId: (raw.projectId as string) || "",
    roles: raw.roles.map((r: unknown, i: number) => {
      const role = r as Record<string, unknown>;
      return {
        name: String(role.name || `role-${i}`),
        description: String(role.description || ""),
        systemPrompt: String(role.systemPrompt || ""),
        model: role.model ? String(role.model) : undefined,
        permissions: role.permissions ? (String(role.permissions) as "skip" | "default") : undefined,
      };
    }),
    phases: raw.phases.map((p: unknown, i: number) => {
      const phase = p as Record<string, unknown>;
      return {
        name: String(phase.name || `phase-${i}`),
        description: String(phase.description || ""),
        order: Number(phase.order) || i,
        roles: Array.isArray(phase.roles) ? phase.roles.map(String) : [],
        completionCriteria: phase.completionCriteria ? String(phase.completionCriteria) : undefined,
        timeout: phase.timeout ? Number(phase.timeout) : undefined,
      };
    }),
    maxRounds: (raw.maxRounds as number) || 1,
    createdAt: new Date(),
  };
}

/** Get the FORGE debates directory for a project */
function getDebatesDir(configPath: string, projectPath: string): string {
  const baseDir = getProjectBaseDir(configPath, projectPath);
  return join(baseDir, "debates");
}

/** Generate a debate output file path */
function getDebateOutputPath(configPath: string, projectPath: string, debateId: string): string {
  const debatesDir = getDebatesDir(configPath, projectPath);
  return join(debatesDir, `${debateId}-output.md`);
}

/** Save debate status to disk */
function saveDebateStatus(
  configPath: string,
  projectPath: string,
  status: DebateStatus,
): void {
  const debatesDir = getDebatesDir(configPath, projectPath);
  if (!existsSync(debatesDir)) {
    mkdirSync(debatesDir, { recursive: true });
  }

  const statusPath = join(debatesDir, `${status.id}-status.json`);
  writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf-8");
}

/** Load debate status from disk */
function loadDebateStatus(
  configPath: string,
  projectPath: string,
  debateId: string,
): DebateStatus | null {
  const debatesDir = getDebatesDir(configPath, projectPath);
  const statusPath = join(debatesDir, `${debateId}-status.json`);

  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    const content = readFileSync(statusPath, "utf-8");
    const raw = JSON.parse(content) as Record<string, unknown>;

    return {
      id: raw.id as string,
      planId: raw.planId as string,
      name: raw.name as string,
      projectId: raw.projectId as string,
      state: raw.state as DebateStatus["state"],
      currentPhase: raw.currentPhase as string | null,
      currentRound: raw.currentRound as number,
      maxRounds: raw.maxRounds as number,
      roles: raw.roles as DebateStatus["roles"],
      phases: raw.phases as DebateStatus["phases"],
      outputFile: raw.outputFile as string | null,
      planPath: raw.planPath as string,
      createdAt: new Date(raw.createdAt as string),
      startedAt: raw.startedAt ? new Date(raw.startedAt as string) : null,
      completedAt: raw.completedAt ? new Date(raw.completedAt as string) : null,
      error: raw.error as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Create a ForgeManager instance */
export function createForgeManager(deps: ForgeManagerDeps): ForgeManager {
  const { config, sessionManager } = deps;

  async function createDebate(planPath: string, projectId: string): Promise<Debate> {
    const project = config.projects[projectId];
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    const plan = loadDebatePlan(planPath);
    plan.projectId = projectId;

    const debateId = `forge-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const outputFile = getDebateOutputPath(config.configPath, project.path, debateId);

    const status: DebateStatus = {
      id: debateId,
      planId: plan.id,
      name: plan.name,
      projectId,
      state: "pending",
      currentPhase: null,
      currentRound: 0,
      maxRounds: plan.maxRounds || 1,
      roles: plan.roles.map((role) => ({
        name: role.name,
        sessionId: null,
        status: "pending",
      })),
      phases: plan.phases.map((phase) => ({
        name: phase.name,
        status: "pending",
      })),
      outputFile,
      planPath,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
    };

    saveDebateStatus(config.configPath, project.path, status);

    return {
      id: debateId,
      plan,
      status,
      sessions: new Map(),
    };
  }

  async function spawnDebateRoles(debateId: string): Promise<DebateStatus> {
    // Find the debate across all projects
    let status: DebateStatus | null = null;
    let project: ProjectConfig | undefined;

    for (const [projectId, proj] of Object.entries(config.projects)) {
      const s = loadDebateStatus(config.configPath, proj.path, debateId);
      if (s) {
        status = s;
        project = proj;
        break;
      }
    }

    if (!status || !project) {
      throw new Error(`Debate not found: ${debateId}`);
    }

    if (status.state === "running") {
      throw new Error(`Debate ${debateId} is already running`);
    }

    // Load the plan
    const plan = loadDebatePlan(status.planPath);

    // Update status to running
    status.state = "running";
    status.startedAt = new Date();
    status.currentPhase = plan.phases[0]?.name || null;
    status.currentRound = 1;

    // Mark first phase as running
    if (status.phases.length > 0) {
      status.phases[0].status = "running";
      status.phases[0].startedAt = new Date();
    }

    saveDebateStatus(config.configPath, project.path, status);

    // Spawn sessions for each role in the first phase
    const firstPhase = plan.phases[0];
    if (!firstPhase) {
      throw new Error(`Debate plan has no phases`);
    }

    const sessionsDir = getSessionsDir(config.configPath, project.path);

    for (const roleName of firstPhase.roles) {
      const role = plan.roles.find((r) => r.name === roleName);
      if (!role) {
        console.warn(`Role ${roleName} not found in plan`);
        continue;
      }

      // Build role-specific prompt
      const rolePrompt = buildRolePrompt(plan, role, firstPhase);

      try {
        // Bootstrap FORGE workspace structure before spawning
        await bootstrapForgeWorkspace(project.path, status.planPath);

        // Spawn session with FORGE context and environment variables
        const session = await sessionManager.spawn({
          projectId: status.projectId,
          prompt: rolePrompt,
          agent: role.model || undefined, // Use role-specific model if specified
          forgeContext: {
            debateId,
            debatePlanPath: status.planPath,
            role: role.name,
            phase: firstPhase.name,
          },
          env: {
            AO_FORGE_DEBATE_ID: debateId,
            AO_FORGE_ROLE: role.name,
            AO_FORGE_PHASE: firstPhase.name,
            AO_FORGE_PROJECT_ID: status.projectId,
            AO_FORGE_PLAN_PATH: status.planPath,
            AO_FORGE_OUTPUT_FILE: status.outputFile || "",
            CLAUDE_ENV: "forge", // Signal FORGE mode to Claude Code
          },
        });

        // Update role status
        const roleStatus = status.roles.find((r) => r.name === role.name);
        if (roleStatus) {
          roleStatus.sessionId = session.id;
          roleStatus.status = "running";
        }

        // Write FORGE metadata to session (merge with existing metadata)
        writeMetadata(sessionsDir, session.id, {
          worktree: session.workspacePath || "",
          branch: session.branch || "",
          status: session.status,
          forgeDebateId: debateId,
          forgeRole: role.name,
          forgePhase: firstPhase.name,
          forgeStatus: "running",
          forgeOutputFile: status.outputFile || "",
          forgePlanPath: status.planPath,
        });
      } catch (err) {
        console.error(`Failed to spawn session for role ${role.name}:`, err);
        const roleStatus = status.roles.find((r) => r.name === role.name);
        if (roleStatus) {
          roleStatus.status = "failed";
        }
      }
    }

    saveDebateStatus(config.configPath, project.path, status);
    return status;
  }

  async function getDebateStatus(debateId: string): Promise<DebateStatus | null> {
    for (const proj of Object.values(config.projects)) {
      const status = loadDebateStatus(config.configPath, proj.path, debateId);
      if (status) {
        // Enrich with live session statuses
        const sessionsDir = getSessionsDir(config.configPath, proj.path);
        for (const role of status.roles) {
          if (role.sessionId) {
            const meta = readMetadataRaw(sessionsDir, role.sessionId);
            if (meta) {
              const forgeStatus = meta["forgeStatus"];
              if (forgeStatus === "completed") {
                role.status = "completed";
              } else if (meta["status"] === "killed" || meta["status"] === "terminated") {
                role.status = "failed";
              }
            }
          }
        }
        return status;
      }
    }
    return null;
  }

  async function killDebate(debateId: string): Promise<void> {
    const status = await getDebateStatus(debateId);
    if (!status) {
      throw new Error(`Debate not found: ${debateId}`);
    }

    // Kill all associated sessions
    for (const role of status.roles) {
      if (role.sessionId && role.status === "running") {
        try {
          await sessionManager.kill(role.sessionId);
          role.status = "failed";
        } catch (err) {
          console.error(`Failed to kill session ${role.sessionId}:`, err);
        }
      }
    }

    // Update debate status
    status.state = "failed";
    status.completedAt = new Date();

    // Find project and save
    const project = config.projects[status.projectId];
    if (project) {
      saveDebateStatus(config.configPath, project.path, status);
    }
  }

  async function listDebates(): Promise<DebateStatus[]> {
    const debates: DebateStatus[] = [];

    for (const proj of Object.values(config.projects)) {
      const debatesDir = getDebatesDir(config.configPath, proj.path);
      if (!existsSync(debatesDir)) continue;

      // Scan for debate status files
      const files = listMetadata(debatesDir);
      for (const file of files) {
        if (file.endsWith("-status.json")) {
          const debateId = file.slice(0, -"-status.json".length);
          const status = await getDebateStatus(debateId);
          if (status) {
            debates.push(status);
          }
        }
      }
    }

    return debates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async function advancePhase(debateId: string): Promise<DebateStatus> {
    const status = await getDebateStatus(debateId);
    if (!status) {
      throw new Error(`Debate not found: ${debateId}`);
    }

    if (status.state !== "running") {
      throw new Error(`Debate ${debateId} is not running`);
    }

    const project = config.projects[status.projectId];
    if (!project) {
      throw new Error(`Project not found: ${status.projectId}`);
    }

    // Complete current phase
    const currentPhaseIdx = status.phases.findIndex((p) => p.name === status.currentPhase);
    if (currentPhaseIdx >= 0) {
      status.phases[currentPhaseIdx].status = "completed";
      status.phases[currentPhaseIdx].completedAt = new Date();
    }

    // Move to next phase
    const nextPhaseIdx = currentPhaseIdx + 1;
    if (nextPhaseIdx >= status.phases.length) {
      // All phases complete
      if (status.currentRound >= status.maxRounds) {
        await completeDebate(debateId, true);
        return (await getDebateStatus(debateId))!;
      } else {
        // Start next round
        status.currentRound++;
        status.currentPhase = status.phases[0]?.name || null;
        for (const phase of status.phases) {
          phase.status = "pending";
          phase.startedAt = undefined;
          phase.completedAt = undefined;
        }
        if (status.phases.length > 0) {
          status.phases[0].status = "running";
          status.phases[0].startedAt = new Date();
        }
      }
    } else {
      status.currentPhase = status.phases[nextPhaseIdx].name;
      status.phases[nextPhaseIdx].status = "running";
      status.phases[nextPhaseIdx].startedAt = new Date();
    }

    saveDebateStatus(config.configPath, project.path, status);
    return status;
  }

  async function completeDebate(
    debateId: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    const status = await getDebateStatus(debateId);
    if (!status) {
      throw new Error(`Debate not found: ${debateId}`);
    }

    const project = config.projects[status.projectId];
    if (!project) {
      throw new Error(`Project not found: ${status.projectId}`);
    }

    status.state = success ? "completed" : "failed";
    status.completedAt = new Date();
    if (error) {
      status.error = error;
    }

    // Mark all running roles as completed/failed
    for (const role of status.roles) {
      if (role.status === "running") {
        role.status = success ? "completed" : "failed";
      }
    }

    saveDebateStatus(config.configPath, project.path, status);
  }

  return {
    createDebate,
    spawnDebateRoles,
    getDebateStatus,
    killDebate,
    listDebates,
    advancePhase,
    completeDebate,
  };
}

/** Build a role-specific prompt for a debate */
function buildRolePrompt(plan: DebatePlan, role: DebateRole, phase: DebatePhase): string {
  return `# FORGE Debate: ${plan.name}

## Your Role: ${role.name}

${role.description}

## Current Phase: ${phase.name}

${phase.description}

## Problem Statement

${plan.problem}

## Your Instructions

${role.systemPrompt}

## Completion Criteria

${phase.completionCriteria || "Complete your analysis and signal completion."}

---

This is a structured debate. Focus on your specific role and responsibilities.
Work within your session. Your output will be aggregated with other roles.
`;
}
