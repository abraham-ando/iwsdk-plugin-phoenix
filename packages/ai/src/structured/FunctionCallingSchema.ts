/**
 * Standardized Function Calling and JSON Tool Schemas for WebLLM and Cloud Providers.
 */

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
}

export class FunctionCallingSchema {
  /**
   * Helper to build a standard tool definition.
   */
  public static createTool(
    name: string,
    description: string,
    properties: Record<string, ToolParameterSchema>,
    required: string[] = []
  ): ToolDefinition {
    return {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    };
  }

  /**
   * Standard VR & RPG Tool Definitions.
   */
  public static readonly STANDARD_TOOLS = {
    GIVE_ITEM: FunctionCallingSchema.createTool(
      'give_item',
      'Give or offer an item or reward to the player in VR',
      {
        itemId: { type: 'string', description: 'Unique identifier of the item' },
        quantity: { type: 'number', description: 'Amount of items to give (1-100)' },
      },
      ['itemId']
    ),
    PLAY_EMOTE: FunctionCallingSchema.createTool(
      'play_emote',
      'Trigger an animation emote or gesture on the NPC avatar',
      {
        emoteName: {
          type: 'string',
          enum: ['WAVE', 'BOW', 'CHEER', 'SCARED', 'THINKING', 'ANGRY'],
          description: 'Name of the emote gesture',
        },
      },
      ['emoteName']
    ),
    CHANGE_EMOTION: FunctionCallingSchema.createTool(
      'change_emotion',
      'Update the internal emotional state and voice tone of the NPC',
      {
        emotion: {
          type: 'string',
          enum: ['NEUTRAL', 'JOY', 'ANGER', 'FEAR', 'SADNESS', 'SURPRISE'],
          description: 'Emotional state',
        },
        intensity: { type: 'number', description: 'Intensity between 0.0 and 1.0' },
      },
      ['emotion']
    ),
    TRIGGER_BANTER: FunctionCallingSchema.createTool(
      'trigger_banter',
      'Start a spoken dialogue with another nearby NPC',
      {
        targetNpcId: { type: 'number', description: 'Entity index of the target NPC' },
        topic: { type: 'string', description: 'Topic or opening line for banter' },
      },
      ['targetNpcId', 'topic']
    ),
  };

  /**
   * Inject tool specifications into a system prompt for models without native tool-call API.
   */
  public static formatToolsForSystemPrompt(tools: ToolDefinition[]): string {
    if (tools.length === 0) return '';

    const toolJson = JSON.stringify(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
      null,
      2
    );

    return (
      `\n\n[OUTILS DISPONIBLES]: Tu as accès aux outils suivants en JSON. ` +
      `Si tu décides d'appeler un outil, réponds avec un bloc JSON strict: {"tool": "<nom_outil>", "args": { ... }}.\n${toolJson}`
    );
  }
}
