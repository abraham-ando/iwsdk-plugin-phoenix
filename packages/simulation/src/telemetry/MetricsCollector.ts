import type { SimKernel } from '../kernel/SimKernel';
import type { GroundTruthWorld } from '../world/GroundTruthWorld';
import type { AgentRuntime } from '../agents/AgentRuntime';
import { wellbeingCost } from '../agents/needs';

/**
 * Continuous run metrics (spec §9.3): (a) belief accuracy, (b) surprise,
 * (c) wellbeing, (d) plan efficiency. Comparing two policies = two runs on
 * the same seed, four curves. Pure observation — never perturbs the sim.
 */
export const METRICS_SAMPLE_PERIOD = 50;

export interface AgentMetrics {
  wellbeingCostIntegral: number;
  beliefDivergenceSum: number;
  beliefDivergenceSamples: number;
  planStepsCompleted: number;
  planStepsFailed: number;
  reflexActionsStarted: number;
  surprises: number;
}

export interface RunMetrics {
  ticks: number;
  samples: number;
  perAgent: Record<string, AgentMetrics & { avgBeliefDivergence: number }>;
}

function emptyAgentMetrics(): AgentMetrics {
  return {
    wellbeingCostIntegral: 0,
    beliefDivergenceSum: 0,
    beliefDivergenceSamples: 0,
    planStepsCompleted: 0,
    planStepsFailed: 0,
    reflexActionsStarted: 0,
    surprises: 0,
  };
}

export class MetricsCollector {
  private perAgent = new Map<string, AgentMetrics>();
  private lastStartSource = new Map<string, 'plan' | 'reflex'>();
  private ticks = 0;
  private samples = 0;

  constructor(
    private world: GroundTruthWorld,
    private runtime: AgentRuntime
  ) {
    this.runtime.subscribeEvents((event) => {
      const metrics = this.agentMetrics(event.agentId);
      if (event.type === 'started') {
        if (event.source === 'reflex') metrics.reflexActionsStarted++;
        if (event.source !== undefined) this.lastStartSource.set(event.agentId, event.source);
        return;
      }
      const source = this.lastStartSource.get(event.agentId);
      if (event.type === 'completed' && source === 'plan') metrics.planStepsCompleted++;
      if (event.type === 'failed') {
        metrics.surprises++;
        if (source === 'plan') metrics.planStepsFailed++;
      }
    });
  }

  private agentMetrics(agentId: string): AgentMetrics {
    let metrics = this.perAgent.get(agentId);
    if (metrics === undefined) {
      metrics = emptyAgentMetrics();
      this.perAgent.set(agentId, metrics);
    }
    return metrics;
  }

  attachTo(kernel: SimKernel): () => void {
    return kernel.onTick((ctx) => {
      this.ticks++;
      if (ctx.tick % METRICS_SAMPLE_PERIOD !== 0) return;
      this.samples++;
      for (const [id, agent] of this.runtime.agents) {
        const metrics = this.agentMetrics(id);
        metrics.wellbeingCostIntegral += wellbeingCost(agent.needs) * METRICS_SAMPLE_PERIOD;
        metrics.beliefDivergenceSum += agent.beliefs.divergenceFrom(this.world);
        metrics.beliefDivergenceSamples++;
      }
    });
  }

  metrics(): RunMetrics {
    const perAgent: RunMetrics['perAgent'] = {};
    for (const [id, m] of this.perAgent) {
      perAgent[id] = {
        ...m,
        avgBeliefDivergence:
          m.beliefDivergenceSamples === 0 ? 0 : m.beliefDivergenceSum / m.beliefDivergenceSamples,
      };
    }
    return { ticks: this.ticks, samples: this.samples, perAgent };
  }
}
