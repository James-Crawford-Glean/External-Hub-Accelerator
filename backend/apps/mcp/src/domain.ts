// The domain seam for the MCP server: the tools your domain advertises.
// mcp/tools.ts appends these to the platform tools; nothing else under
// apps/mcp imports domain code. To replace the example, delete tools/items/
// and rewrite this file (an empty registration is `DOMAIN_TOOLS = []`).
import type { ToolDefinition } from './mcp/tools';
import { searchItems } from './tools/items/searchItems';
import { createItem } from './tools/items/createItem';
import { updateItem } from './tools/items/updateItem';

export const DOMAIN_TOOLS: readonly ToolDefinition[] = [searchItems, createItem, updateItem];
