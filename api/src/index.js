import { API } from './server.js';
import { DAL } from './dal.js';

const port = process.env.PORT;
const dal = new DAL();

try {
    await dal.init();
} catch (error) {
    console.error('Failed to initialize DAL:', error);
    process.exit(1);
}

const server = new API(dal);

try {
    await server.init();
} catch (error) {
    console.error('Failed to initialize API:', error);
    process.exit(1);
}

server.app.listen(port, () => {
    console.log(`API listening on port ${port}`);
});