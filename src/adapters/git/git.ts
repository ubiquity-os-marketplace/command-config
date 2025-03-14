import { Context } from "../../types/context";
import { GitSuper } from "./super";

export class GitAdapter extends GitSuper {
  constructor(context: Context) {
    super(context);
  }
}
