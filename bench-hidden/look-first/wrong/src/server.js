import { createServer } from 'node:http';
import { settings as config } from './settings.js';

createServer((req, res) => {
  res.end(`shop-front on ${config.env}, talking to ${config.apiUrl}\n`);
}).listen(config.port, () => console.log(`listening on ${config.port}`));
