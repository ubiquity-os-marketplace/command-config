import { Context } from "../../types/context";
import { GitSuper } from "./super/index";

export class GitAdapter extends GitSuper {
  constructor(context: Context) {
    super(context);
  }
}
