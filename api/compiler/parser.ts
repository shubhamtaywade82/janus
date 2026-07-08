import * as fs from 'fs';
import { FinancialKernelIR, MarketObjectDefinition, StateTransition } from './fkir';

export class JanusSpecParser {
  public parseFile(filePath: string): FinancialKernelIR {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentModule = '';
    let currentVersion = '1.0.0';
    const imports: string[] = [];

    let insideObject = false;
    let objectName = '';
    let objectFacets: MarketObjectDefinition['facets'] = { domain: [], spatial: [], lifecycle: [], execution: [] };
    let objectData: Record<string, any> = {};
    let objectStates: string[] = [];
    let objectOutcomes: string[] = [];
    const objectTransitions: StateTransition[] = [];
    const objectAffordances: string[] = [];

    let currentBlock = '';
    let braceDepth = 0;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('//')) continue;

      // Module parsing
      if (line.startsWith('module ')) {
        const parts = line.replace('module ', '').replace(';', '').split('@');
        currentModule = parts[0];
        currentVersion = parts[1] || '1.0.0';
        continue;
      }

      // Import parsing
      if (line.startsWith('import ')) {
        const imp = line.replace('import ', '').replace(';', '').trim();
        imports.push(imp);
        continue;
      }

      // Object declaration
      if (line.startsWith('object ')) {
        insideObject = true;
        objectName = line.split(' ')[1].replace('{', '').trim();
        braceDepth = 1;
        continue;
      }

      // Handle braces and nesting depth
      if (line.includes('{')) {
        braceDepth++;
        if (insideObject && braceDepth === 2) {
          currentBlock = line.split('{')[0].trim();
        }
        continue;
      }

      if (line.includes('}')) {
        braceDepth--;
        if (braceDepth === 1) {
          currentBlock = '';
        } else if (braceDepth === 0) {
          insideObject = false;
        }
        continue;
      }

      // Parse fields inside object blocks
      if (insideObject && braceDepth === 2) {
        if (currentBlock === 'facets') {
          const parts = line.split(':');
          if (parts.length === 2) {
            const key = parts[0].trim();
            const val = parts[1].replace(';', '').trim();
            if (key === 'domain') objectFacets.domain.push(val);
            if (key === 'spatial') objectFacets.spatial.push(val);
            if (key === 'lifecycle') objectFacets.lifecycle.push(val);
            if (key === 'execution') objectFacets.execution.push(val);
          }
        }

        if (currentBlock === 'data') {
          const parts = line.split(':');
          if (parts.length === 2) {
            const key = parts[0].trim();
            const val = parts[1].replace(';', '').trim();
            objectData[key] = val;
          }
        }

        if (currentBlock === 'lifecycle') {
          if (line.startsWith('states:')) {
            objectStates = line
              .replace('states:', '')
              .replace('[', '')
              .replace(']', '')
              .replace(';', '')
              .split(',')
              .map(s => s.trim());
          }
          if (line.startsWith('outcomes:')) {
            objectOutcomes = line
              .replace('outcomes:', '')
              .replace('[', '')
              .replace(']', '')
              .replace(';', '')
              .split(',')
              .map(s => s.trim());
          }
        }

        if (currentBlock === 'affordances') {
          objectAffordances.push(line.replace(';', '').trim());
        }
      }
    }

    const objects: MarketObjectDefinition[] = [];
    if (objectName) {
      objects.push({
        id: `${currentModule}.${objectName}`,
        category: 'Imbalance',
        facets: objectFacets,
        components: objectData,
        lifecycle: {
          states: objectStates,
          outcomes: objectOutcomes,
          transitions: objectTransitions
        },
        affordances: objectAffordances
      });
    }

    return {
      version: '1.0.0',
      sourceVersion: currentVersion,
      compiledAt: Date.now(),
      physics: [],
      objects,
      interactions: [],
      relationships: [],
      systems: [],
      policies: [],
      events: []
    };
  }
}
