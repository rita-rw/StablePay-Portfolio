import "dotenv/config";
import { app } from "./app";
import { startListener } from "./listener";

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`StablePay backend running on http://localhost:${PORT}`);
});

startListener().catch((err) => {
  console.error("[listener] failed to start", err);
});
