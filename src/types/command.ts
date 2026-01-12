import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";

export const commandSchema = T.Object({
  name: T.Literal("config"),
  parameters: T.Object({
    editor_instruction: T.Optional(T.String()),
    editorInstruction: T.Optional(T.String()),
  }),
});

export type Command = StaticDecode<typeof commandSchema>;
