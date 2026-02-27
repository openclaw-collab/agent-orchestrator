/**
 * GET /api/forge/debates
 *
 * List all FORGE debates across all projects.
 */

import { NextResponse } from "next/server";
import { loadConfig, createForgeManager, createSessionManager, createPluginRegistry, type DebateStatus } from "@composio/ao-core";

export async function GET(): Promise<Response> {
  try {
    const config = loadConfig();

    // Create plugin registry and load built-in plugins
    const registry = createPluginRegistry();
    await registry.loadBuiltins(config);

    // Create session manager and forge manager
    const sessionManager = createSessionManager({
      config,
      registry,
    });

    const forgeManager = createForgeManager({
      config,
      sessionManager,
    });

    const debates = await forgeManager.listDebates();

    // Serialize dates for JSON
    const serializedDebates = debates.map((d: DebateStatus) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
      startedAt: d.startedAt?.toISOString() || null,
      completedAt: d.completedAt?.toISOString() || null,
    }));

    return NextResponse.json(serializedDebates);
  } catch (err) {
    console.error("[GET /api/forge/debates] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
