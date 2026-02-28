import chalk from "chalk";
import ora from "ora";
import type { Command } from "commander";
import { loadConfig } from "@composio/ao-core";
import { getForgeManager } from "../lib/create-forge-manager.js";
import { banner } from "../lib/format.js";
import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/**
 * Parse a BMAD PRD file and extract key information
 */
function parsePRD(prdPath: string): { name: string; description: string; problem: string; requirements: string[] } {
  if (!existsSync(prdPath)) {
    throw new Error(`PRD file not found: ${prdPath}`);
  }

  const content = readFileSync(prdPath, "utf-8");

  // Try to parse YAML frontmatter
  let frontmatter: Record<string, unknown> = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    try {
      frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
    } catch {
      // Ignore parse errors
    }
  }

  // Extract project name from title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const name = frontmatter.project_name as string ||
               frontmatter.name as string ||
               (titleMatch ? titleMatch[1].replace(/^Product Requirements Document\s*[-–]\s*/, "").trim() : "FORGE Project");

  // Extract description from Executive Summary or first paragraph
  const execSummaryMatch = content.match(/##\s*Executive Summary\s*\n\n([\s\S]*?)(?=\n##|\n*$)/i);
  const firstParaMatch = content.match(/\n\n([^#\n][^\n]*\n)/);
  const description = execSummaryMatch ?
    execSummaryMatch[1].trim().slice(0, 200) :
    (firstParaMatch ? firstParaMatch[1].trim().slice(0, 200) : "FORGE workflow from PRD");

  // Extract functional requirements
  const frMatch = content.match(/##\s*Functional Requirements\s*\n\n([\s\S]*?)(?=\n##|\n*$)/i);
  const requirements: string[] = [];
  if (frMatch) {
    const frSection = frMatch[1];
    const frLines = frSection.match(/^-\s+.+$/gm);
    if (frLines) {
      frLines.forEach(line => {
        const req = line.replace(/^-\s+/, "").trim();
        if (req) requirements.push(req);
      });
    }
  }

  // Build problem statement from requirements
  const problem = requirements.length > 0
    ? `Implement: ${requirements.slice(0, 3).join("; ")}${requirements.length > 3 ? "..." : ""}`
    : description;

  return { name, description, problem, requirements };
}

/**
 * Create a debate plan YAML from PRD content
 */
function createDebatePlanFromPRD(prdInfo: ReturnType<typeof parsePRD>): string {
  const plan = {
    id: `prd-${Date.now()}`,
    name: prdInfo.name,
    description: prdInfo.description,
    problem: prdInfo.problem,
    roles: [
      {
        name: "advocate",
        description: "Champions the primary implementation approach",
        systemPrompt: "You are the ADVOCATE. Make the strongest case FOR the leading implementation option. Emphasize strengths, comparative advantages, and success criteria.",
      },
      {
        name: "skeptic",
        description: "Probes weaknesses and challenges assumptions",
        systemPrompt: "You are the SKEPTIC. Challenge assumptions, find failure modes, and identify risks. Ask 'what could go wrong?'",
      },
      {
        name: "operator",
        description: "Assesses implementation feasibility",
        systemPrompt: "You are the OPERATOR. Assess feasibility from ground truth. Consider resources, timeline, dependencies, and operational constraints.",
      },
      {
        name: "synthesizer",
        description: "Reconciles positions and produces decision",
        systemPrompt: "You are the SYNTHESIZER. Read all positions, resolve tradeoffs, and produce a clear, actionable decision with rationale.",
      },
    ],
    phases: [
      {
        name: "explore",
        description: "Explore implementation approaches",
        roles: ["advocate", "skeptic"],
        completionCriteria: "Multiple approaches documented with tradeoffs",
      },
      {
        name: "validate",
        description: "Validate feasibility and risks",
        roles: ["operator", "skeptic"],
        completionCriteria: "Feasibility confirmed, risks identified",
      },
      {
        name: "decide",
        description: "Make final implementation decision",
        roles: ["synthesizer"],
        completionCriteria: "Clear decision with rationale documented",
      },
    ],
    maxRounds: 1,
  };

  return JSON.stringify(plan, null, 2);
}

export function registerForge(program: Command): void {
  const forge = program
    .command("forge")
    .description("FORGE — Multi-Agent Debate System");

  // forge init — Create a new debate from a plan file
  forge
    .command("init")
    .description("Create a new debate from a plan file")
    .argument("<plan>", "Path to debate plan YAML file")
    .argument("<project>", "Project ID from config")
    .action(async (planPath: string, projectId: string) => {
      const config = loadConfig();
      if (!config.projects[projectId]) {
        console.error(
          chalk.red(
            `Unknown project: ${projectId}\nAvailable: ${Object.keys(config.projects).join(", ")}`,
          ),
        );
        process.exit(1);
      }

      const spinner = ora("Creating debate").start();

      try {
        const fm = await getForgeManager(config);
        const debate = await fm.createDebate(planPath, projectId);

        spinner.succeed(`Debate ${chalk.green(debate.id)} created`);
        console.log(`  Name: ${chalk.dim(debate.plan.name)}`);
        console.log(`  Project: ${chalk.dim(projectId)}`);
        console.log(`  Roles: ${chalk.dim(debate.plan.roles.map((r: { name: string }) => r.name).join(", "))}`);
        console.log(`  Phases: ${chalk.dim(debate.plan.phases.map((p: { name: string }) => p.name).join(", "))}`);
        console.log();
        console.log(`Run ${chalk.cyan(`ao forge run ${debate.id}`)} to start the debate`);
      } catch (err) {
        spinner.fail("Failed to create debate");
        console.error(chalk.red(`✗ ${err}`));
        process.exit(1);
      }
    });

  // forge run — Start a debate and spawn all roles
  forge
    .command("run")
    .description("Start a debate and spawn all agent sessions")
    .argument("<debate>", "Debate ID")
    .action(async (debateId: string) => {
      const config = loadConfig();
      const spinner = ora("Starting debate").start();

      try {
        const fm = await getForgeManager(config);
        const status = await fm.spawnDebateRoles(debateId);

        spinner.succeed(`Debate ${chalk.green(debateId)} started`);
        console.log();
        console.log(chalk.bold("Roles:"));
        for (const role of status.roles) {
          const statusColor = role.status === "running" ? chalk.green : role.status === "failed" ? chalk.red : chalk.yellow;
          console.log(`  ${chalk.dim(role.name)}: ${statusColor(role.status)}${role.sessionId ? chalk.dim(` (${role.sessionId})`) : ""}`);
        }
        console.log();
        console.log(`Current phase: ${chalk.cyan(status.currentPhase || "none")}`);
        console.log(`Round: ${chalk.cyan(String(status.currentRound))}/${chalk.cyan(String(status.maxRounds))}`);
      } catch (err) {
        spinner.fail("Failed to start debate");
        console.error(chalk.red(`✗ ${err}`));
        process.exit(1);
      }
    });

  // forge status — Show debate status
  forge
    .command("status")
    .description("Show debate status")
    .argument("[debate]", "Debate ID (omit to list all debates)")
    .action(async (debateId?: string) => {
      const config = loadConfig();

      try {
        const fm = await getForgeManager(config);

        if (debateId) {
          // Show specific debate
          const status = await fm.getDebateStatus(debateId);
          if (!status) {
            console.error(chalk.red(`Debate not found: ${debateId}`));
            process.exit(1);
          }

          console.log(banner(`FORGE DEBATE: ${status.name}`));
          console.log();

          const stateColor = status.state === "completed" ? chalk.green : status.state === "failed" ? chalk.red : status.state === "running" ? chalk.cyan : chalk.yellow;
          console.log(`  State: ${stateColor(status.state)}`);
          console.log(`  ID: ${chalk.dim(status.id)}`);
          console.log(`  Project: ${chalk.dim(status.projectId)}`);
          console.log(`  Current Phase: ${chalk.dim(status.currentPhase || "—")}`);
          console.log(`  Round: ${chalk.dim(`${String(status.currentRound)}/${String(status.maxRounds)}`)}`);
          console.log(`  Created: ${chalk.dim(status.createdAt.toLocaleString())}`);
          if (status.startedAt) {
            console.log(`  Started: ${chalk.dim(status.startedAt.toLocaleString())}`);
          }
          if (status.completedAt) {
            console.log(`  Completed: ${chalk.dim(status.completedAt.toLocaleString())}`);
          }
          if (status.error) {
            console.log(`  Error: ${chalk.red(status.error)}`);
          }
          console.log();

          console.log(chalk.bold("Phases:"));
          for (const phase of status.phases) {
            const phaseColor = phase.status === "completed" ? chalk.green : phase.status === "running" ? chalk.cyan : chalk.dim;
            const marker = phase.name === status.currentPhase ? chalk.cyan("→ ") : "  ";
            console.log(`${marker}${phaseColor(phase.name)} ${chalk.dim(`(${phase.status})`)}`);
          }
          console.log();

          console.log(chalk.bold("Roles:"));
          for (const role of status.roles) {
            const roleColor = role.status === "completed" ? chalk.green : role.status === "running" ? chalk.cyan : role.status === "failed" ? chalk.red : chalk.yellow;
            const sessionInfo = role.sessionId ? chalk.dim(` → ${role.sessionId}`) : "";
            console.log(`  ${chalk.dim(role.name)}: ${roleColor(role.status)}${sessionInfo}`);
          }
        } else {
          // List all debates
          const debates = await fm.listDebates();

          if (debates.length === 0) {
            console.log(chalk.dim("No debates found."));
            console.log();
            console.log(`Create one with: ${chalk.cyan("ao forge init <plan> <project>")}`);
            return;
          }

          console.log(banner("FORGE DEBATES"));
          console.log();

          for (const d of debates) {
            const stateColor = d.state === "completed" ? chalk.green : d.state === "failed" ? chalk.red : d.state === "running" ? chalk.cyan : chalk.yellow;
            const activeRoles = d.roles.filter((r: { status: string }) => r.status === "running").length;
            const completedRoles = d.roles.filter((r: { status: string }) => r.status === "completed").length;

            console.log(`${chalk.bold(d.name)} ${chalk.dim(`(${d.id})`)}`);
            console.log(`  State: ${stateColor(d.state)}`);
            console.log(`  Project: ${chalk.dim(d.projectId)}`);
            console.log(`  Progress: ${chalk.dim(`${String(completedRoles)}/${String(d.roles.length)} roles, ${d.currentPhase || "—"}`)}`);
            if (d.state === "running" && activeRoles > 0) {
              console.log(`  Active: ${chalk.cyan(String(activeRoles))} ${chalk.dim("roles running")}`);
            }
            console.log();
          }
        }
      } catch (err) {
        console.error(chalk.red(`✗ ${err}`));
        process.exit(1);
      }
    });

  // forge kill — Stop a debate and kill all sessions
  forge
    .command("kill")
    .description("Stop a debate and kill all agent sessions")
    .argument("<debate>", "Debate ID")
    .action(async (debateId: string) => {
      const config = loadConfig();
      const spinner = ora("Killing debate").start();

      try {
        const fm = await getForgeManager(config);
        await fm.killDebate(debateId);

        spinner.succeed(`Debate ${chalk.green(debateId)} killed`);
      } catch (err) {
        spinner.fail("Failed to kill debate");
        console.error(chalk.red(`✗ ${err}`));
        process.exit(1);
      }
    });

  // forge init-from-prd — Create a debate from a BMAD PRD file
  forge
    .command("init-from-prd")
    .description("Create a FORGE debate from a BMAD-generated PRD")
    .argument("<prd>", "Path to PRD markdown file")
    .argument("<project>", "Project ID from config")
    .option("--output <path>", "Save generated plan to this path")
    .action(async (prdPath: string, projectId: string, options: { output?: string }) => {
      const config = loadConfig();

      if (!config.projects[projectId]) {
        console.error(
          chalk.red(
            `Unknown project: ${projectId}\nAvailable: ${Object.keys(config.projects).join(", ")}`,
          ),
        );
        process.exit(1);
      }

      const spinner = ora("Parsing PRD").start();

      try {
        // Parse PRD
        const prdInfo = parsePRD(prdPath);
        spinner.succeed(`Parsed PRD: ${chalk.green(prdInfo.name)}`);

        // Create debate plan from PRD
        spinner.start("Generating debate plan");
        const planYaml = createDebatePlanFromPRD(prdInfo);

        // Save plan to temp file or specified output
        const planPath = options.output || `/tmp/forge-plan-${Date.now()}.yaml`;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(planPath, planYaml, "utf-8");
        spinner.succeed(`Generated debate plan: ${chalk.dim(planPath)}`);

        // Create debate
        spinner.start("Creating FORGE debate");
        const fm = await getForgeManager(config);
        const debate = await fm.createDebate(planPath, projectId);

        spinner.succeed(`Debate ${chalk.green(debate.id)} created`);
        console.log();
        console.log(`  Name: ${chalk.dim(debate.plan.name)}`);
        console.log(`  Project: ${chalk.dim(projectId)}`);
        console.log(`  Roles: ${chalk.dim(debate.plan.roles.map((r: { name: string }) => r.name).join(", "))}`);
        console.log(`  Phases: ${chalk.dim(debate.plan.phases.map((p: { name: string }) => p.name).join(", "))}`);
        console.log();
        console.log(`Next steps:`);
        console.log(`  1. Run ${chalk.cyan(`ao forge run ${debate.id}`)} to spawn role sessions`);
        console.log(`  2. Or start the FORGE session directly:`);
        console.log(`     ${chalk.cyan(`ao spawn ${projectId} "Initialize FORGE workflow" --forge-debate ${debate.id}`)}`);
      } catch (err) {
        spinner.fail("Failed to create debate from PRD");
        console.error(chalk.red(`✗ ${err}`));
        process.exit(1);
      }
    });
}
