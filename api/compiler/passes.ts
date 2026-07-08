import { FinancialKernelIR, MarketObjectDefinition } from './fkir';

export interface CompilerPass {
  name: string;
  execute(ir: FinancialKernelIR): FinancialKernelIR;
}

/**
 * Pass 1: Capability Inference
 * Automatically derives implicit capabilities from explicit facets.
 * e.g., Zone + Finite -> Mitigatable
 */
export class CapabilityInferencePass implements CompilerPass {
  public name = 'CapabilityInference';

  public execute(ir: FinancialKernelIR): FinancialKernelIR {
    const updatedObjects = ir.objects.map(obj => {
      const hasZone = obj.facets.spatial.includes('Zone');
      const hasFinite = obj.facets.lifecycle.includes('Finite');
      
      const newAffordances = [...obj.affordances];
      if (hasZone && hasFinite && !newAffordances.includes('Mitigatable')) {
        newAffordances.push('Mitigatable');
      }

      return {
        ...obj,
        affordances: newAffordances
      };
    });

    return {
      ...ir,
      objects: updatedObjects
    };
  }
}

/**
 * Pass 2: Event Minimization & Generation
 * Mechanically derives event schemas from Object lifecycles and transitions
 */
export class EventGenerationPass implements CompilerPass {
  public name = 'EventGeneration';

  public execute(ir: FinancialKernelIR): FinancialKernelIR {
    const generatedEvents = [...ir.events];

    for (const obj of ir.objects) {
      // Create Object Lifecycle State Events
      for (const state of obj.lifecycle.states) {
        const eventId = `${obj.id}.${state.toLowerCase()}`;
        if (!generatedEvents.some(e => e.id === eventId)) {
          generatedEvents.push({
            id: eventId,
            aggregate: obj.id,
            payload: {
              objectId: 'string',
              timestamp: 'timestamp',
              ...obj.components
            },
            generatedFrom: {
              sourceId: obj.id,
              triggerType: 'LIFECYCLE_TRANSITION'
            }
          });
        }
      }

      // Create Object Outcomes Events
      for (const outcome of obj.lifecycle.outcomes) {
        const eventId = `${obj.id}.${outcome.toLowerCase()}`;
        if (!generatedEvents.some(e => e.id === eventId)) {
          generatedEvents.push({
            id: eventId,
            aggregate: obj.id,
            payload: {
              objectId: 'string',
              timestamp: 'timestamp',
              outcome: 'string',
              price: 'float'
            },
            generatedFrom: {
              sourceId: obj.id,
              triggerType: 'OUTCOME'
            }
          });
        }
      }
    }

    return {
      ...ir,
      events: generatedEvents
    };
  }
}

/**
 * Pass Manager Orchestrator
 */
export class PassManager {
  private passes: CompilerPass[] = [];

  public registerPass(pass: CompilerPass) {
    this.passes.push(pass);
  }

  public run(ir: FinancialKernelIR): FinancialKernelIR {
    let currentIr = { ...ir };
    for (const pass of this.passes) {
      currentIr = pass.execute(currentIr);
    }
    return currentIr;
  }
}
