# Autofix for Malformed JSON Tool Calls

This module provides automatic fixing of malformed JSON in tool calls, similar to Octo's approach.

## Problem

Some model providers don't support strict constraints on how tool calls are generated, and models can make mistakes generating JSON. This can cause:
- Stream interruptions
- Failed tool executions
- Poor user experience

## Solution

The autofix module uses a lightweight secondary model (default: `hf:syntheticlab/fix-json`) to repair broken JSON before validation fails.

## Usage

### Basic Usage with Agent

```typescript
import { Agent } from "@mariozechner/agent";
import { getAutofixConfigFromEnv } from "@mariozechner/pi-ai";

const agent = new Agent({
  autofixConfig: getAutofixConfigFromEnv(),
  // ... other options
});
```

### Configuration Options

```typescript
import { Agent } from "@mariozechner/agent";

const agent = new Agent({
  autofixConfig: {
    enabled: true,
    baseUrl: "https://api.synthetic.new/v1",
    model: "hf:syntheticlab/fix-json",
    apiKey: process.env.SYNTHETIC_API_KEY,
    temperature: 0,
  },
});
```

### Environment Variables

You can configure autofix via environment variables:

- `PI_AUTOFIX_ENABLED` - Set to `"false"` to disable autofix
- `PI_AUTOFIX_BASE_URL` - Base URL for the fix model API
- `PI_AUTOFIX_MODEL` - Model ID to use for fixing JSON
- `SYNTHETIC_API_KEY` - API key for the default synthetic provider

### Disabling Autofix

```typescript
// Disable via config
const agent = new Agent({
  autofixConfig: { enabled: false },
});

// Or disable via environment
process.env.PI_AUTOFIX_ENABLED = "false";
```

## How It Works

1. When a tool call is received with malformed JSON, the system first attempts standard parsing
2. If parsing fails and autofix is enabled, it sends the broken JSON to a fix model
3. The fix model attempts to repair the JSON and returns valid JSON
4. The repaired JSON is then validated against the tool schema
5. If validation succeeds, the tool executes normally
6. If autofix fails, the original error is thrown with a note about the failed fix attempt

## Events

The agent emits events during autofix:

```typescript
agent.subscribe((event) => {
  if (event.type === "autofix_start") {
    console.log(`Fixing malformed JSON for ${event.toolName}`);
  }
  if (event.type === "autofix_end") {
    if (event.success) {
      console.log(`Successfully fixed JSON for ${event.toolName}`);
    } else {
      console.log(`Failed to fix JSON: ${event.error}`);
    }
  }
});
```

## Provider-Specific Fixes

The `parseStreamingJson` utility is now used in all providers to gracefully handle incomplete or malformed JSON during streaming:

- `openai-completions.ts` - Uses `parseStreamingJson` instead of `JSON.parse`
- `openai-responses-shared.ts` - Uses `parseStreamingJson` for function call arguments

This prevents crashes when models generate invalid JSON during streaming.

## API Reference

### `autofixJson(brokenJson, config?, signal?)`

Attempts to fix malformed JSON using a secondary model.

**Parameters:**
- `brokenJson: string` - The malformed JSON string
- `config?: AutofixConfig` - Configuration options
- `signal?: AbortSignal` - Abort signal for cancellation

**Returns:** `Promise<AutofixResult>`

### `parseJsonWithAutofix(jsonString, config?, signal?)`

Attempts to parse JSON with autofix fallback.

**Parameters:**
- `jsonString: string | undefined` - The JSON string to parse
- `config?: AutofixConfig` - Configuration options
- `signal?: AbortSignal` - Abort signal for cancellation

**Returns:** `Promise<unknown | null>`

### `validateToolArgumentsWithAutofix(tool, toolCall, autofixConfig?, signal?)`

Validates tool arguments with autofix support for malformed JSON.

**Parameters:**
- `tool: Tool` - The tool definition
- `toolCall: ToolCall` - The tool call from the LLM
- `autofixConfig?: AutofixConfig` - Configuration for autofix
- `signal?: AbortSignal` - Abort signal for cancellation

**Returns:** `Promise<any>` - The validated arguments

### `getAutofixConfigFromEnv()`

Creates an autofix configuration from environment variables.

**Returns:** `AutofixConfig`

## Performance Considerations

- Autofix adds an additional LLM call when JSON is malformed
- The fix model is typically small and cheap (e.g., `hf:syntheticlab/fix-json`)
- Failed autofix attempts are cached to avoid repeated attempts on the same malformed JSON

## Error Handling

When autofix fails, the original validation error is thrown with an additional note:

```
Validation failed for tool "bash":
  - root: invalid type

Received arguments:
{
  "command": "ls -la",
  "extra": "invalid"
}

Note: Attempted autofix but validation still failed.
```

This helps the model understand that the JSON was attempted to be fixed but still has issues.
