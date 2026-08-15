/**
 * Smart objects declare the world's action repertoire (spec §4.1): the engine
 * knows no verbs of its own. Every affordance serializes 1:1 into an LLM
 * tool definition later (étape 4).
 */
export type Comparison = string; // '>0' | '<1.5' | '>=1' | '<=3' | '==1'

export interface AffordanceDef {
  verb: string;
  durationTicks: number;
  preconditions?: {
    objectState?: Record<string, Comparison>;
    actorDistance?: Comparison;
    actorInventory?: Record<string, Comparison>;
  };
  effects: {
    object?: Record<string, number>;
    actorInventory?: Record<string, number>;
  };
}

export interface SmartObjectDef {
  affordances: AffordanceDef[];
  state: Record<string, number>;
  regrowth?: Array<{ field: string; perDay: number; max: number }>;
}

export interface SmartObjectInstance {
  id: string;
  type: string;
  x: number;
  z: number;
  state: Record<string, number>;
}

export class SmartObjectRegistry {
  private defs = new Map<string, SmartObjectDef>();

  define(type: string, def: SmartObjectDef): void {
    if (this.defs.has(type)) {
      throw new Error(`SmartObjectRegistry.define: duplicate type ${type}`);
    }
    this.defs.set(type, def);
  }

  get(type: string): SmartObjectDef {
    const def = this.defs.get(type);
    if (def === undefined) {
      throw new Error(`SmartObjectRegistry.get: unknown type ${type}`);
    }
    return def;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  types(): string[] {
    return [...this.defs.keys()].sort();
  }
}
