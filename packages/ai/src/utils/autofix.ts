/**
 * Autofix utility for repairing malformed JSON tool calls.
 *
 * This module provides functionality to automatically fix broken JSON
 * using a lightweight secondary model, similar to Octo's approach.
 */

import OpenAI from "openai";
import { getEnvApiKey } from "../env-api-keys.js";

/**
 * Configuration for the autofix feature
 */
export interface AutofixConfig {
	/** Whether autofix is enabled */
	enabled: boolean;
	/** Base URL for the autofix model API */
	baseUrl?: string;
	/** API key for the autofix model */
	apiKey?: string;
	/** Model ID to use for fixing JSON */
	model?: string;
	/** Temperature for the fix model (should be low for deterministic fixes) */
	temperature?: number;
}

/**
 * Result of an autofix attempt
 */
export interface AutofixResult {
	/** Whether the fix was successful */
	success: boolean;
	/** The fixed JSON (if successful) */
	fixed?: unknown;
	/** Error message (if unsuccessful) */
	error?: string;
}

/**
 * Default configuration for autofix
 */
export const DEFAULT_AUTOFIX_CONFIG: AutofixConfig = {
	enabled: true,
	baseUrl: "https://api.synthetic.new/v1",
	model: "hf:syntheticlab/fix-json",
	temperature: 0,
};

/**
 * Prompt template for fixing JSON
 */
function createFixJsonPrompt(brokenJson: string): string {
	return `The following string may be broken JSON. Fix it if possible. Respond with JSON in the following format:

{
  "success": true | false,
  "fixed": <the parsed JSON if success is true>
}

If it's more-or-less JSON, fix it and respond with success: true.
If it's not fixable, respond with success: false.

Here's the string to fix:
${brokenJson}`;
}

/**
 * Attempts to fix malformed JSON using a secondary model
 *
 * @param brokenJson The malformed JSON string
 * @param config Autofix configuration
 * @param signal Abort signal for cancellation
 * @returns AutofixResult indicating success or failure
 */
export async function autofixJson(
	brokenJson: string,
	config: Partial<AutofixConfig> = {},
	signal?: AbortSignal,
): Promise<AutofixResult> {
	const fullConfig = { ...DEFAULT_AUTOFIX_CONFIG, ...config };

	if (!fullConfig.enabled) {
		return { success: false, error: "Autofix is disabled" };
	}

	const baseUrl = fullConfig.baseUrl || DEFAULT_AUTOFIX_CONFIG.baseUrl;
	const model = fullConfig.model || DEFAULT_AUTOFIX_CONFIG.model;
	const apiKey = fullConfig.apiKey || getEnvApiKey("synthetic") || "";

	if (!apiKey) {
		return { success: false, error: "No API key available for autofix model" };
	}

	try {
		const client = new OpenAI({
			baseURL: baseUrl,
			apiKey,
		});

		const response = await client.chat.completions.create(
			{
				model: model!,
				temperature: fullConfig.temperature,
				messages: [
					{
						role: "user",
						content: createFixJsonPrompt(brokenJson),
					},
				],
				response_format: { type: "json_object" },
			},
			signal ? { signal } : undefined,
		);

		const content = response.choices[0]?.message?.content;
		if (!content) {
			return { success: false, error: "Empty response from fix model" };
		}

		// Parse the response
		let parsed: { success?: boolean; fixed?: unknown };
		try {
			parsed = JSON.parse(content);
		} catch {
			return { success: false, error: "Fix model returned invalid JSON" };
		}

		if (parsed.success && parsed.fixed !== undefined) {
			return { success: true, fixed: parsed.fixed };
		}

		return { success: false, error: "Could not fix malformed JSON" };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Attempts to parse JSON with autofix fallback
 *
 * @param jsonString The JSON string to parse
 * @param config Autofix configuration
 * @param signal Abort signal for cancellation
 * @returns Parsed JSON or null if parsing fails
 */
export async function parseJsonWithAutofix(
	jsonString: string | undefined,
	config: Partial<AutofixConfig> = {},
	signal?: AbortSignal,
): Promise<unknown | null> {
	if (!jsonString || jsonString.trim() === "") {
		return {};
	}

	// Try standard parsing first
	try {
		return JSON.parse(jsonString);
	} catch {
		// Try autofix if available
		const result = await autofixJson(jsonString, config, signal);
		if (result.success) {
			return result.fixed;
		}
		return null;
	}
}

/**
 * Creates an autofix configuration from environment variables
 *
 * Checks for:
 * - PI_AUTOFIX_ENABLED (true/false)
 * - PI_AUTOFIX_BASE_URL
 * - PI_AUTOFIX_MODEL
 * - SYNTHETIC_API_KEY (for default provider)
 *
 * @returns Autofix configuration
 */
export function getAutofixConfigFromEnv(): AutofixConfig {
	const enabled = process.env.PI_AUTOFIX_ENABLED !== "false";
	const baseUrl = process.env.PI_AUTOFIX_BASE_URL || DEFAULT_AUTOFIX_CONFIG.baseUrl;
	const model = process.env.PI_AUTOFIX_MODEL || DEFAULT_AUTOFIX_CONFIG.model;
	const apiKey = getEnvApiKey("synthetic") || undefined;

	return {
		enabled,
		baseUrl,
		model,
		apiKey,
		temperature: 0,
	};
}
