const {Role, DB} = require("../src/database/database");

function expectValidJwt(potentialJwt) {
    expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

async function createAdminUser({password, name, email}) {
    let user = { password, name, email, roles: [{ role: Role.Admin }] };
    user = await DB.addUser(user);
    return { ...user, password };
}

function randomName() {
    return Math.random().toString(36).substring(2, 12);
}

module.exports = { expectValidJwt, createAdminUser, randomName };