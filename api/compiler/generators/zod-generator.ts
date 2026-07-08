import type { FinancialKernelIR, MarketObjectDefinition, DataType } from "../fkir";

export class ZodSchemaGenerator {
  public generate(ir: FinancialKernelIR): string {
    const parts: string[] = [];
    parts.push(`// Auto-generated Zod schemas from JDS compiler v${ir.version}`);
    parts.push(`// Source: ${ir.sourceVersion}`);
    parts.push(`import { z } from "zod";`);
    parts.push("");

    for (const obj of ir.objects) {
      parts.push(this.generateObjectSchema(obj));
    }

    for (const evt of ir.events) {
      parts.push(this.generateEventSchema(evt));
    }

    return parts.join("\n");
  }

  private generateObjectSchema(obj: MarketObjectDefinition): string {
    const lines: string[] = [];
    const name = this.safeName(obj.id);
    lines.push(`// ${obj.id}`);
    lines.push(`export const ${name}Schema = z.object({`);
    lines.push(`  id: z.string(),`);
    lines.push(`  type: z.literal("${name}"),`);

    for (const [key, type] of Object.entries(obj.components)) {
      lines.push(`  ${key}: ${this.toZodType(type as DataType)},`);
    }

    const stateUnion = obj.lifecycle.states.map(s => `z.literal("${s.toLowerCase()}")`).join(",\n    ");
    lines.push(`  state: z.union([${stateUnion}]),`);
    lines.push(`  createdAt: z.number(),`);
    lines.push(`  updatedAt: z.number(),`);
    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`);
    lines.push("");
    return lines.join("\n");
  }

  private generateEventSchema(evt: any): string {
    const lines: string[] = [];
    const name = this.safeName(evt.id).replace(/event$/i, "") + "Event";
    lines.push(`// Event: ${evt.id}`);
    lines.push(`export const ${name}Schema = z.object({`);
    lines.push(`  eventType: z.literal("${evt.id}"),`);
    lines.push(`  aggregateId: z.string(),`);
    lines.push(`  timestamp: z.number(),`);

    for (const [key, type] of Object.entries(evt.payload)) {
      lines.push(`  ${key}: ${this.toZodType(type as DataType)},`);
    }

    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`);
    lines.push("");
    return lines.join("\n");
  }

  private toZodType(type: DataType): string {
    if (typeof type === "string") {
      const map: Record<string, string> = {
        float: "z.number()",
        integer: "z.number().int()",
        string: "z.string()",
        boolean: "z.boolean()",
        timestamp: "z.number()",
        PricePoint: "z.number()",
      };
      return map[type] ?? "z.unknown()";
    }
    if ("enum" in type) {
      const literals = type.enum.map(v => `z.literal("${v.toLowerCase()}")`).join(",\n      ");
      return `z.union([${literals}])`;
    }
    if ("list" in type) {
      return `z.array(${this.toZodType(type.list as DataType)})`;
    }
    return "z.unknown()";
  }

  private safeName(id: string): string {
    return id
      .split(".")
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }
}
