# JDS-022: Event Schema Evolution & Versioning Strategy
Version: 1.0
Status: Approved

This document specifies the strategies for modifying event payload structures without corrupting historical logs.

```
+--------------------------------------------------------------------------+
|                        UPCASTER SCHEMA MIGRATION                         |
|                                                                          |
|  [Historical Event DB (v1)] ---> [Upcaster Pipeline] ---> [Entity (v2)]  |
+--------------------------------------------------------------------------+
```

## 1. Schema Versioning Rules
- **Rule 1**: Event types contain version markers in metadata (e.g. `schemaVersion: 2`).
- **Rule 2**: Only additive changes (new optional fields) are allowed in minor updates.
- **Rule 3**: Structural modifications require an `EventUpcaster` implementation.

---

## 2. Event Upcaster Specification
Upcasters act as lazy migration middleware during database retrieval.

```typescript
interface EventUpcaster<TIn = any, TOut = any> {
  eventType: string;
  sourceVersion: number;
  targetVersion: number;
  upcast(payload: TIn): TOut;
}

// Example Upcaster implementation adding leverage fields
class PositionOpenedV1ToV2Upcaster implements EventUpcaster {
  eventType = 'janus.execution.position_opened';
  sourceVersion = 1;
  targetVersion = 2;

  upcast(payload: any): any {
    return {
      ...payload,
      leverage: payload.leverage ?? 5.0, // Default fallback value
      marginType: payload.marginType ?? 'ISOLATED'
    };
  }
}
```
