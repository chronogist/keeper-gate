/* eslint-disable no-console */
import { KeeperHubClient } from "../src/index.js";

const apiKey = process.env.KEEPERHUB_API_KEY!;
const client = new KeeperHubClient({ apiKey });

const wfs = await client.listWorkflows();
const wf = await client.getWorkflow(wfs[0]!.id);
console.log(JSON.stringify(wf, null, 2));
