import { createApp } from "./app.js";
import { APP_NAME, config } from "./config.js";

const app = createApp();
app.listen(config.port, () => {
  console.log(`${APP_NAME} API on http://localhost:${config.port}  (Meta key ${process.env.META_MODEL_API_KEY ? "configured" : "MISSING"})`);
});
