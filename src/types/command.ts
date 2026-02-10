import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";

export const commandSchema = T.Object({
  name: T.Literal("config", { description: 'Configure the UbiquityOS plugin.', examples: ['/config <editor_instruction>'] }),
  parameters: T.Object({
    editor_instruction: T.Optional(T.String({ description: "Instruction used to update plugin configuration.", examples: ["set response mode to concise"] })),
    editorInstruction: T.Optional(T.String({ description: "Instruction used to update plugin configuration.", examples: ["set response mode to concise"] })),
  }),
});

export type Command = StaticDecode<typeof commandSchema>;
