const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../src/index');

const CONFIG_PATH = path.join(__dirname, '../config/config.json');

describe('Scalar Relay API Tests', () => {
    beforeAll(() => {
        // Ensure config exists for tests
        if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        }
        const testConfig = {
            smtp: { host: 'localhost', port: 1025, user: 'test', pass: 'test' },
            primaryEmail: 'test@example.com',
            dashboardPassword: 'password123',
            keys: [{ id: 'master', key: 'test-api-key', label: 'Test Key' }]
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(testConfig));
    });

    test('health check returns UP', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('UP');
    });

    test('unauthorized access to setup redirect', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(302);
        expect(response.header.location).toBe('/login');
    });

    test('API send requires valid key', async () => {
        const response = await request(app)
            .post('/api/send')
            .send({ to: 'user@example.com', subject: 'Test', text: 'Hello' });
        expect(response.status).toBe(401);
    });

    test('API send accepts valid key (simulated failure due to no SMTP server)', async () => {
        const response = await request(app)
            .post('/api/send')
            .set('x-api-key', 'test-api-key')
            .send({ to: 'user@example.com', subject: 'Test', text: 'Hello' });
        // Since no real SMTP server is running, it should return 500 but indicate it passed authentication
        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
    });
});
