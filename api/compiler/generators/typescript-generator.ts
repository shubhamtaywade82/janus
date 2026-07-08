import type { FinancialKernelIR, MarketObjectDefinition, DataType } from "../fkir";

export interface GenerateOptions {
  outputDir?: string;
  namespace?: string;
}

export class TypeScriptGenerator {
  private options: GenerateOptions;

  constructor(options: GenerateOptions = {}) {
    this.options = options;
  }

  public generate(ir: FinancialKernelIR): string {
    const parts: string[] = [];
    parts.push(`// Auto-generated from JDS compiler v${ir.version}`);
    parts.push(`// Source: ${ir.sourceVersion}`);
    parts.push(`// Compiled: ${new Date(ir.compiledAt).toISOString()}`);
    parts.push("");

    if (this.options.namespace) {
      parts.push(`namespace ${this.options.namespace} {`);
    }

    for (const obj of ir.objects) {
      parts.push(this.generateObjectType(obj));
    }

    for (const rel of ir.relationships) {
      parts.push(this.generateRelationshipType(rel));
    }

    for (const evt of ir.events) {
      parts.push(this.generateEventType(evt));
    }

    if (this.options.namespace) {
      parts.push("}");
    }

    return parts.join("\n");
  }

  private generateObjectType(obj: MarketObjectDefinition): string {
    const lines: string[] = [];
    lines.push(`// ${obj.id}`);
    lines.push(`// Facets: domain=${obj.facets.domain.join(",")} lifecycle=${obj.facets.lifecycle.join(",")}`);
    lines.push(`export interface ${this.safeName(obj.id)} {`);
    lines.push(`  readonly id: string;`);
    lines.push(`  readonly type: "${this.safeName(obj.id)}";`);

    for (const [key, type] of Object.entries(obj.components)) {
      lines.push(`  ${key}: ${this.toTypeScriptType(type as DataType)};`);
    }

    lines.push(`  state: ${obj.lifecycle.states.map(s => `"${s.toLowerCase()}"`).join(" | ")};`);
    lines.push(`  affordances: ${obj.affordances.map(a => `"${a}"`).join(" | ")};`);
    lines.push(`  createdAt: number;`);
    lines.push(`  updatedAt: number;`);
    lines.push(`}`);
    lines.push(``);
    return lines.join("\n");
  }

  private generateRelationshipType(rel: any): string {
    const lines: string[] = [];
    lines.push(`// Relationship: ${rel.id}`);
    lines.push(`export interface ${this.safeName(rel.id)} {`);
    lines.push(`  readonly id: string;`);
    lines.push(`  kind: "${rel.kind}";`);
    lines.push(`  sourceId: string;`);
    lines.push(`  targetId: string;`);
    lines.push(`  state: ${rel.lifecycle.states.map((s: string) => `"${s.toLowerCase()}"`).join(" | ")};`);
    lines.push(`  createdAt: number;`);
    lines.push(`  updatedAt: number;`);
    lines.push(`}`);
    lines.push(``);
    return lines.join("\n");
  }

  private generateEventType(evt: any): string {
    const lines: string[] = [];
    lines.push(`// Event: ${evt.id}`);
    lines.push(`export interface ${this.safeName(evt.id).replace(/event$/, "")}Event {`);
    lines.push(`  readonly eventType: "${evt.id}";`);
    lines.push(`  readonly aggregateId: string;`);
    lines.push(`  readonly timestamp: number;`);

    for (const [key, type] of Object.entries(evt.payload)) {
      lines.push(`  ${key}: ${this.toTypeScriptType(type as DataType)};`);
    }

    lines.push(`}`);
    lines.push(``);
    return lines.join("\n");
  }

  private toTypeScriptType(type: DataType): string {
    if (typeof type === "string") {
      const map: Record<string, string> = {
        float: "number",
        integer: "number",
        string: "string",
        boolean: "boolean",
        timestamp: "number",
        PricePoint: "number",
      };
      return map[type] ?? "unknown";
    }
    if ("enum" in type) {
      return type.enum.map(v => `"${v.toLowerCase()}"`).join(" | ");
    }
    if ("list" in type) {
      return `${this.toTypeScriptType(type.list as DataType)}[]`;
    }
    return "unknown";
  }

  private safeName(id: string): string {
    return id
      .split(".")
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }
}
