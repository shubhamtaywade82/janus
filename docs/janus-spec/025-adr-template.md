# JDS-025: Architectural Decision Records
Version: 1.0
Status: Approved

This document defines the template for Architecture Decision Records (ADRs) and lists key architectural decisions.

## 1. ADR Template

```
# ADR-[ID]: [Title]

## Context & Problem Statement
Describe the problem we are trying to solve and the context.

## Decision Drivers
- Driver 1
- Driver 2

## Considered Options
- Option 1
- Option 2

## Decision Outcome
Selected option and explanation.

### Consequences
- Good consequences
- Bad/challenging consequences
```

---

## 2. ADR-001: Event Sourcing for Trade Lifecycle

### Context & Problem Statement
Trading platforms require comprehensive audit trails to diagnose why positions were opened, modified, or closed by autonomous agents.

### Decision Outcome
We choose **Event Sourcing** for the `TradeWorkflow` and `Portfolio` state tracking rather than storing only the current state in standard relational rows. This guarantees that every step of a trade's lifecycle is saved as an immutable event.

### Consequences
- **Positive**: Complete audit logs of every execution decision; ability to perform exact historical replays for debugging.
- **Negative**: Higher developer complexity; requires upcasting pipelines to manage schema evolution.
