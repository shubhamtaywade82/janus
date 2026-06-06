import { EventEmitter } from "events";

// Shared bus for LLM advisor decisions. Lives in the service layer (not the router)
// so both the auto-executor (emitter) and the llm-router subscription (consumer) can
// import it without a service→router circular dependency.
export const llmDecisionEvents = new EventEmitter();
llmDecisionEvents.setMaxListeners(50);
