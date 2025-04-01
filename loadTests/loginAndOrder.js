import { sleep, check, group, fail } from 'k6'
import http from 'k6/http'
import jsonpath from 'https://jslib.k6.io/jsonpath/1.0.2/index.js'

export const options = {
    cloud: {
        distribution: { 'amazon:us:columbus': { loadZone: 'amazon:us:columbus', percent: 100 } },
        apm: [],
    },
    thresholds: {},
    scenarios: {
        Scenario_1: {
            executor: 'ramping-vus',
            gracefulStop: '30s',
            stages: [
                { target: 20, duration: '30s' },
                { target: 0, duration: '30s' },
            ],
            gracefulRampDown: '30s',
            exec: 'scenario_1',
        },
    },
}

export function scenario_1() {
    let response

    const vars = {}

    // Homepage
    response = http.get('https://pizza.whimples.com', {
        headers: {
            accept: '*/*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/json',
            dnt: '1',
        },
    })

    sleep(3)

    // Login
    response = http.put(
        'https://pizza-service.whimples.com/api/auth',
        '{"email":"a@jwt.com","password":"admin"}',
        {
            headers: {
                accept: '*/*',
                'accept-encoding': 'gzip, deflate, br, zstd',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'application/json',
                dnt: '1',
                origin: 'https://pizza.whimples.com',
                priority: 'u=1, i',
            },
        }
    )
    if (!check(response, { 'status equals 200': response => response.status.toString() === '200' })) {
        console.log(response.body);
        fail('Login was *not* 200');
    }

    try {
        const authResponse = response.json();
        vars['token'] = jsonpath.query(authResponse, '$.token')[0];
        if (!vars['token']) {
            console.error('Failed to extract token from auth response');
        }
    } catch (e) {
        console.error('Error parsing auth response as JSON:', e.message);
    }

    sleep(3)

    // Get Menu
    response = http.get('https://pizza-service.whimples.com/api/order/menu', {
        headers: {
            accept: '*/*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            authorization: `Bearer ${vars['token']}`,
            'content-type': 'application/json',
            dnt: '1',
            origin: 'https://pizza.whimples.com',
        },
    })

    sleep(3)

    response = http.get('https://pizza-service.whimples.com/api/franchise', {
        headers: {
            accept: '*/*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            authorization: `Bearer ${vars['token']}`,
            'content-type': 'application/json',
            dnt: '1',
            origin: 'https://pizza.whimples.com',
            priority: 'u=1, i',
        },
    })
    sleep(10)

    // Purchase Pizza
    const orderPayload = JSON.stringify({
        "items": [
            {"menuId":1,"description":"Veggie","price":0.0038},
            {"menuId":5,"description": "Hawaiian","price":0.0099},
            {"menuId":2,"description":"Pepperoni","price":0.0042},
            {"menuId":3,"description":"Margarita","price":0.0042}
        ],
        "storeId":"1",
        "franchiseId":2
    });

    response = http.post(
        'https://pizza-service.whimples.com/api/order',
        orderPayload,
        {
            headers: {
                accept: '*/*',
                'accept-encoding': 'gzip, deflate, br, zstd',
                'accept-language': 'en-US,en;q=0.9',
                authorization: `Bearer ${vars['token']}`,
                'content-type': 'application/json',
                dnt: '1',
                origin: 'https://pizza.whimples.com',
                priority: 'u=1, i',
            },
        }
    )

    if (!check(response, { 'status equals 200': response => response.status.toString() === '200' })) {
        console.log(response.body);
        fail('Order was *not* 200');
    }

    try {
        const orderResponse = response.json();
        vars['jwt'] = jsonpath.query(orderResponse, '$.jwt')[0];
        if (!vars['jwt']) {
            console.error('Failed to extract jwt from order response');
        }
    } catch (e) {
        console.error('Error parsing order response as JSON:', e.message);
    }

    sleep(3)

    // Verify Pizza - Fixed domain to match previous URLs pattern
    response = http.post(
        'https://pizza-factory.cs329.click/api/order/verify',
        JSON.stringify({"jwt": vars['jwt'] || ""}),
        {
            headers: {
                accept: '*/*',
                'accept-encoding': 'gzip, deflate, br, zstd',
                'accept-language': 'en-US,en;q=0.9',
                authorization: `Bearer ${vars['token']}`,
                'content-type': 'application/json',
                dnt: '1',
                origin: 'https://pizza.whimples.com',
                priority: 'u=1, i',
            },
        }
    )
}