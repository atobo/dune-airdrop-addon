// Deliberately tiny process entrypoint: the integration test exercises the
// production daemon module while retaining control over its disposable runtime.
import { start } from "../../daemon/index.js";
await start();
