const request = require('supertest');
const app = require('../../src/service');
const {randomName, createAdminUser, expectValidJwt} = require('../utils')

const testUser = { name: 'pizza diner', email: 'diner@test.com', password: 'a' };
const adminName = randomName();
const adminUser = { name: adminName, email: adminName + '@admin.com', password: 'toomanysecrets'};
let testUserAuthToken;
let testUserId;
let adminUserAuthToken;
let testMenuItem;  // Initial menu item created in beforeAll
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

    // Create initial menu item
    const menuItem = {
        title: randomName(),
        description: 'Test pizza description',
        image: 'pizza1.png',
        price: 0.0001
    };

    const menuRes = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(menuItem);
    testMenuItem = menuRes.body.find(item => item.title === menuItem.title);

    // Create a franchise and store for order tests
    const franchise = {
        name: randomName(),
        admins: [{ email: testUser.email }]
    };
    const franchiseRes = await request(app)
        .post('/api/franchise')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(franchise);
    testFranchiseId = franchiseRes.body.id;

    const store = {
        name: randomName()
    };
    const storeRes = await request(app)
        .post(`/api/franchise/${testFranchiseId}/store`)
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(store);
    testStoreId = storeRes.body.id;
});

test('get menu', async () => {
    const res = await request(app).get('/api/order/menu');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                id: expect.any(Number),
                title: testMenuItem.title,
                price: testMenuItem.price,
                description: testMenuItem.description,
                image: testMenuItem.image
            })
        ])
    );
});

test('add menu item (as admin)', async () => {
    const menuItem = {
        title: randomName(),
        description: 'New test pizza',
        image: 'pizza2.png',
        price: 0.0001
    };

    const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${adminUserAuthToken}`)
        .send(menuItem);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(item => item.title === menuItem.title)).toBe(true);
    const addedItem = res.body.find(item => item.title === menuItem.title);
    expect(addedItem.description).toBe(menuItem.description);
    expect(addedItem.price).toBe(menuItem.price);
    expect(addedItem.image).toBe(menuItem.image);
});

test('fail to add menu item (as non-admin)', async () => {
    const menuItem = {
        title: randomName(),
        description: 'Unauthorized pizza',
        image: 'pizza3.png',
        price: 0.0002
    };

    const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(menuItem);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('unable to add menu item');
});

test('get orders (empty)', async () => {
    const res = await request(app)
        .get('/api/order')
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(res.status).toBe(200);
    expect(res.body.dinerId).toBe(testUserId);
    expect(Array.isArray(res.body.orders)).toBe(true);
});

test('create order and verify in orders list', async () => {
    // Mock the factory API response
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ reportUrl: 'http://test.com/report', jwt: 'test-jwt' })
        })
    );

    const order = {
        franchiseId: testFranchiseId,
        storeId: testStoreId,
        items: [{
            menuId: testMenuItem.id,
            description: testMenuItem.description,
            price: testMenuItem.price
        }]
    };

    const createRes = await request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(order);

    expect(createRes.status).toBe(200);
    expect(createRes.body.order.franchiseId).toBe(order.franchiseId);
    expect(createRes.body.order.storeId).toBe(order.storeId);
    expect(createRes.body.order.items).toEqual(order.items);
    expect(createRes.body.reportSlowPizzaToFactoryUrl).toBe('http://test.com/report');
    expect(createRes.body.jwt).toBe('test-jwt');

    // Verify order appears in list
    const listRes = await request(app)
        .get('/api/order')
        .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.orders.some(order => order.id === createRes.body.order.id)).toBe(true);

    // Restore original fetch
    global.fetch = originalFetch;
});

test('create order (factory error)', async () => {
    // Mock the factory API error response
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ reportUrl: 'http://test.com/error' })
        })
    );

    const order = {
        franchiseId: testFranchiseId,
        storeId: testStoreId,
        items: [{
            menuId: testMenuItem.id,
            description: testMenuItem.description,
            price: testMenuItem.price
        }]
    };

    const res = await request(app)
        .post('/api/order')
        .set('Authorization', `Bearer ${testUserAuthToken}`)
        .send(order);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to fulfill order at factory');
    expect(res.body.reportPizzaCreationErrorToPizzaFactoryUrl).toBe('http://test.com/error');

    // Restore original fetch
    global.fetch = originalFetch;
});