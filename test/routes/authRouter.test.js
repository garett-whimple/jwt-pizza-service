const request = require('supertest');
const app = require('../../src/service');
const { Role, DB } = require('../../src/database/database.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
const adminName = randomName()
const adminUser = { name: adminName, email: adminName + '@admin.com', password: 'toomanysecrets'}
let testUserAuthToken;
let testUserId
let adminUserAuthToken;

beforeAll(async () => {
    await createAdminUser(adminUser)
    const loginRes = await request(app).put('/api/auth').send(adminUser);

    adminUserAuthToken = loginRes.body.token;
    expectValidJwt(adminUserAuthToken);
});

beforeEach(async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser);
    testUserAuthToken = registerRes.body.token;
    testUserId = registerRes.body.user.id
    expectValidJwt(testUserAuthToken);
});

test('login', async () => {
    const loginRes = await request(app).put('/api/auth').send(testUser);
    expect(loginRes.status).toBe(200);
    expectValidJwt(loginRes.body.token);

    const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
    delete expectedUser.password;
    expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('register', async () => {
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser)
    const body = registerRes.body
    expectValidJwt(body.token)
    expect(registerRes.status).toBe(200)
    expect(body.user.email).toMatch(testUser.email)
    expect(body.user.name).toMatch(testUser.name)
})

test('bad register', async () => {
    testUser.email = null
    const registerRes = await request(app).post('/api/auth').send(testUser)
    const body = registerRes.body
    expect(registerRes.status).toBe(400)
    expect(body.message).toMatch('name, email, and password are required')
})

test('logout', async () => {
    const loginRes = await request(app).put('/api/auth').send(testUser);
    const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${loginRes.body.token}`).send(testUser)
    const body = logoutRes.body

    expect(logoutRes.status).toBe(200)
    expect(body.message).toBe('logout successful')
})

test('bad logout', async () => {
    const logoutRes = await request(app).delete('/api/auth').send(testUser)
    const body = logoutRes.body

    expect(logoutRes.status).toBe(401)
    expect(body.message).toBe('unauthorized')
})

test('update user', async () => {
    const updateUser = { email: 'new@test.com', password: 'new' }
    const updateRes = await request(app).put(`/api/auth/${testUserId}`).set('Authorization', `Bearer ${adminUserAuthToken}`).send(updateUser)
    const body = updateRes.body

    expect(updateRes.status).toBe(200)
    expect(body.email).toBe(updateUser.email)
})

function expectValidJwt(potentialJwt) {
    expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

async function createAdminUser({password, name, email}) {
    let user = { password: password, name: name, email: email, roles: [{ role: Role.Admin }] };

    user = await DB.addUser(user);
    return { ...user, password };
}

function randomName() {
    return Math.random().toString(36).substring(2, 12);
}