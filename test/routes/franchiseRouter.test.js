const request = require('supertest');
const app = require('../../src/service');
const {randomName, createAdminUser, expectValidJwt} = require('../utils')

const testUser = { name: 'pizza franchisee', email: 'f@jwt.com', password: 'a' };
const adminName = randomName();
const adminUser = { name: adminName, email: adminName + '@admin.com', password: 'toomanysecrets'};
let testUserAuthToken;
let testUserId;
let adminUserAuthToken;
let testFranchiseId;
let testStoreId;

beforeAll(async () => {
    // Test admin
    await createAdminUser(adminUser);
    const loginRes = await request(app).put('/api/auth').send(adminUser);
    adminUserAuthToken = loginRes.body.token;
    expectValidJwt(adminUserAuthToken);

    // Test user
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = registerRes.body.token;
    testUserId = registerRes.body.user.id;
    expectValidJwt(testUserAuthToken);

    // Test franchise
    const franchise = {
        name: randomName(),
        admins: [{ email: testUser.email }]
    };
    const franchiseRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(franchise);
    testFranchiseId = franchiseRes.body.id;

    // Test store
    const store = {
        name: randomName()
    };
    const storeRes = await request(app)
        .post(`/api/franchise/${testFranchiseId}/store`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(store);
    testStoreId = storeRes.body.id;
});

test('list all franchises', async () => {
    const res = await request(app).get('/api/franchise');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some(f => f.id === testFranchiseId)).toBe(true);
});

test('create franchise (as admin)', async () => {
    const franchise = {
        name: randomName(),
        admins: [{ email: testUser.email }]
    };

    const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(franchise);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(franchise.name);
    expect(res.body.admins[0].email).toBe(testUser.email);
});

test('fail to create franchise (as non-admin)', async () => {
    const franchise = {
        name: randomName(),
        admins: [{ email: testUser.email }]
    };

    const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(franchise);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('unable to create a franchise');
});

test('get user franchises', async () => {
    const res = await request(app)
        .get(`/api/franchise/${testUserId}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(f => f.id === testFranchiseId)).toBe(true);
});

test('fail to get other user franchises', async () => {
    const otherUserId = testUserId + 1;
    const res = await request(app)
        .get(`/api/franchise/${otherUserId}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
});

test('create store', async () => {
    const store = {
        name: randomName()
    };

    const res = await request(app)
        .post(`/api/franchise/${testFranchiseId}/store`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(store);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(store.name);
});

test('fail to create store (unauthorized)', async () => {
    const store = {
        name: randomName()
    };

    // Create a new user that's not a franchise admin
    const otherUser = {
        name: randomName(),
        email: Math.random().toString(36).substring(2, 12) + '@test.com',
        password: 'pwd'
    };
    const registerRes = await request(app).post('/api/auth').send(otherUser);
    const otherUserToken = registerRes.body.token;

    const res = await request(app)
        .post(`/api/franchise/${testFranchiseId}/store`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send(store);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('unable to create a store');
});

test('delete store and create new one', async () => {
    // Delete the store
    const deleteRes = await request(app)
        .delete(`/api/franchise/${testFranchiseId}/store/${testStoreId}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toBe('store deleted');

    // Create a new store to maintain test state
    const store = {
        name: randomName()
    };
    const createRes = await request(app)
        .post(`/api/franchise/${testFranchiseId}/store`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(store);

    testStoreId = createRes.body.id;
    expect(createRes.status).toBe(200);
});

test('fail to delete store (unauthorized user)', async () => {
    const otherUser = {
        name: randomName(),
        email: Math.random().toString(36).substring(2, 12) + '@test.com',
        password: 'pwd'
    };
    const registerRes = await request(app).post('/api/auth').send(otherUser);
    const otherUserToken = registerRes.body.token;

    const res = await request(app)
        .delete(`/api/franchise/${testFranchiseId}/store/${testStoreId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('unable to delete a store');
});

test('create and delete franchise (as admin)', async () => {
    const franchise = {
        name: randomName(),
        admins: [{ email: testUser.email }]
    };

    const createRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(franchise);

    expect(createRes.status).toBe(200);
    const newFranchiseId = createRes.body.id;

    const deleteRes = await request(app)
        .delete(`/api/franchise/${newFranchiseId}`)
        .set('Authorization', `Bearer ${adminUserAuthToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.message).toBe('franchise deleted');
});

test('fail to delete franchise (as non-admin)', async () => {
    const res = await request(app)
        .delete(`/api/franchise/${testFranchiseId}`)
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('unable to delete a franchise');
});