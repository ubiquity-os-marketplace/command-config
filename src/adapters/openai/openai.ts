import OpenAI from "openai";
import { Context } from "../../types/index";

export class SuperOpenAi {
  protected client: OpenAI;
  protected context: Context;
  constructor(client: OpenAI, context: Context) {
    this.client = client;
    this.context = context;
  }
}
