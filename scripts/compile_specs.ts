import * as path from 'path';
import { JanusSpecParser } from '../api/compiler/parser';
import { PassManager, CapabilityInferencePass, EventGenerationPass } from '../api/compiler/passes';

async function main() {
  console.log('=== JANUS FINANCIAL KERNEL COMPILER ===');
  
  const parser = new JanusSpecParser();
  const specPath = path.resolve('specs/ontology/imbalance/FairValueGap.jds');
  
  console.log(`Parsing JDS source: ${specPath}`);
  const rawIr = parser.parseFile(specPath);
  
  console.log('\n--- Raw Parsed Object ---');
  console.log(JSON.stringify(rawIr.objects[0], null, 2));

  // Initialize Pass Manager
  const manager = new PassManager();
  manager.registerPass(new CapabilityInferencePass());
  manager.registerPass(new EventGenerationPass());

  console.log('\nExecuting Pass Manager Pipeline...');
  const optimizedIr = manager.run(rawIr);

  console.log('\n--- Optimized Object Affordances (with Inferred Capabilities) ---');
  console.log(JSON.stringify(optimizedIr.objects[0].affordances, null, 2));

  console.log('\n--- Generated Event Vocabulary (Layer Derived) ---');
  console.log(JSON.stringify(optimizedIr.events.map(e => e.id), null, 2));
  console.log(`Total Generated Events: ${optimizedIr.events.length}`);
}

main().catch(err => {
  console.error('Compilation failed:', err);
  process.exit(1);
});
