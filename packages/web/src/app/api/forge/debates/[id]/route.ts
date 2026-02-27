/**
 * GET /api/forge/debates/[id]
 *
 * Get a specific FORGE debate by ID.
 */

import { NextResponse } from "next/server";
import { loadConfig, createForgeManager, createSessionManager, createPluginRegistry } from "@composio/ao-core";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  _request: Request,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id } = await params;
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

    const debate = await forgeManager.getDebateStatus(id);

    if (!debate) {
      return NextResponse.json(
        { error: "Debate not found" },
        { status: 404 }
      );
    }

    // Serialize dates for JSON
    const serializedDebate = {
      ...debate,
      createdAt: debate.createdAt.toISOString(),
      startedAt: debate.startedAt?.toISOString() || null,
      completedAt: debate.completedAt?.toISOString() || null,
    };

    return NextResponse.json(serializedDebate);
  } catch (err) {
    console.error(`[GET /api/forge/debates/${(await params).id}] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/forge/debates/[id]/advance
 *
 * Advance a debate to the next phase.
 */
export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  try {
    const { id } = await params;
    const config = loadConfig();

    // Parse action from request body
    const body = await request.json() as { action?: string };
    const action = body.action || "advance";

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

    if (action === "advance") {
      const debate = await forgeManager.advancePhase(id);
      return NextResponse.json({
        ...debate,
        createdAt: debate.createdAt.toISOString(),
        startedAt: debate.startedAt?.toISOString() || null,
        completedAt: debate.completedAt?.toISOString() || null,
      });
    }

    if (action === "complete") {
      await forgeManager.completeDebate(id, true);
      const debate = await forgeManager.getDebateStatus(id);
      if (!debate) {
        return NextResponse.json(
          { error: "Debate not found after completion" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        ...debate,
        createdAt: debate.createdAt.toISOString(),
        startedAt: debate.startedAt?.toISOString() || null,
        completedAt: debate.completedAt?.toISOString() || null,
      });
    }

    if (action === "kill") {
      await forgeManager.killDebate(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error(`[POST /api/forge/debates/${(await params).id}] Error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
