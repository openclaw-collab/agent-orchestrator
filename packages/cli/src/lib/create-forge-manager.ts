/**
 * Factory for creating a ForgeManager with all dependencies.
 *
 * This module creates a ForgeManager instance with the session manager
 * and plugin registry wired up.
 */

import type { OrchestratorConfig, ForgeManager } from "@composio/ao-core";
import { createForgeManager as createCoreForgeManager, createSessionManager, createPluginRegistry } from "@composio/ao-core";

let forgeManagerCache: ForgeManager | null = null;
let configCache: OrchestratorConfig | null = null;

/**
 * Get or create a ForgeManager instance.
 *
 * The ForgeManager is cached for the lifetime of the process to avoid
 * recreating plugin registry and session manager on every call.
 */
export async function getForgeManager(config: OrchestratorConfig): Promise<ForgeManager> {
  // Return cached instance if config hasn't changed
  if (forgeManagerCache && configCache === config) {
    return forgeManagerCache;
  }

  // Create plugin registry and load built-in plugins
  const registry = createPluginRegistry();
  await registry.loadBuiltins(config);

  // Create session manager
  const sessionManager = createSessionManager({
    config,
    registry,
  });

  // Create forge manager
  const forgeManager = createCoreForgeManager({
    config,
    sessionManager,
  });

  // Cache for reuse
  forgeManagerCache = forgeManager;
  configCache = config;

  return forgeManager;
}

/** Clear the cached ForgeManager (useful for testing) */
export function clearForgeManagerCache(): void {
  forgeManagerCache = null;
  configCache = null;
}
