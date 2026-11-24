import { z, defineStep } from "strut";

export default defineStep({
  type: "stadeum/canvas/fail",
  description: "Fail the run with the given message: the `canvas` workflow's refusal, so a refused draft or plan ends the run saying why.",
  effect: "read",
  input: z.object({ message: z.string().min(1) }),
  output: z.any(),
  async run(cfg) {
    throw new Error(cfg.message);
  },
});
