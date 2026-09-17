import { requireAuth } from "../middleware/auth";
import { compose } from "../middleware/compose";
import { issueToken } from "../services/auth";

export const loginHandler = compose(requireAuth, async (_req, res) => {
  const token = await issueToken("user-1");
  res.status(200).json({ token });
});

export function mount(app: { post: (path: string, handler: unknown) => void }) {
  app.post("/login", loginHandler);
}
