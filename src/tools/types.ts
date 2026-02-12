import type { z } from "zod";

export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: TSchema;
  handler: (input: z.infer<TSchema>) => Promise<unknown>;
}
