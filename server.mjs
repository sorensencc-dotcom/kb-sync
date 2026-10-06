import { createGatewayServer, PORT, HOST } from '../icf/src/server.mjs';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : PORT;
const host = process.env.ICF_HOST || '0.0.0.0';

const server = createGatewayServer();

server.listen(port, host, () => {
  console.log(`[ICF Gateway Server] Running at http://${host}:${port}`);
  console.log(`[ICF Gateway Server] Dashboard: http://${host}:${port}/dashboard`);
  console.log(`[ICF Gateway Server] Meridian: http://${host}:${port}/api/reporting/meridian`);
});

export default server;
