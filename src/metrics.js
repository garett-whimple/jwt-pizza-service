const config = require('./config');
const os = require('os');

// Store metrics data
const metrics = {
    requests: {},
    auth: {
        successful: 0,
        failed: 0
    },
    activeUsers: new Set(),
    pizzas: {
        sold: 0,
        failures: 0,
        revenue: 0
    },
    latency: {
        endpoints: {},
        pizzaCreation: []
    }
};

// Middleware to track HTTP requests
function track() {
    return (req, res, next) => {
        const startTime = Date.now();
        const path = req.originalUrl || req.url;
        const method = req.method;
        const key = `${method}:${path}`;

        // Track request
        metrics.requests[key] = (metrics.requests[key] || 0) + 1;

        // Track authenticated user
        if (req.user && req.user.id) {
            metrics.activeUsers.add(req.user.id);
        }

        // Track response status and latency on completion
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const statusKey = `${method}:${path}:${res.statusCode}`;
            metrics.requests[statusKey] = (metrics.requests[statusKey] || 0) + 1;

            // Track endpoint latency
            if (!metrics.latency.endpoints[key]) {
                metrics.latency.endpoints[key] = [];
            }
            metrics.latency.endpoints[key].push(duration);
        });

        next();
    };
}

// Track authentication attempts
function trackAuth(success, userId) {
    if (success) {
        metrics.auth.successful++;
        if (userId) {
            metrics.activeUsers.add(userId);
        }
    } else {
        metrics.auth.failed++;
    }
}

function trackAuthLogout(userId) {
    if (metrics.activeUsers.has(userId)) {
        metrics.activeUsers.delete(userId)
    }
}

// Track pizza orders
function trackPizzaOrder(order, success, duration) {
    if (success) {
        // Calculate number of pizzas and revenue
        const pizzaCount = order.items.length;
        const revenue = order.items.reduce((total, item) => total + item.price, 0);

        metrics.pizzas.sold += pizzaCount;
        metrics.pizzas.revenue += revenue;

        // Track latency for successful pizza creation
        if (duration) {
            metrics.latency.pizzaCreation.push(duration);
        }
    } else {
        metrics.pizzas.failures++;
    }
}

// Get CPU usage percentage
function getCpuUsagePercentage() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return parseFloat((cpuUsage * 100).toFixed(2));
}

// Get memory usage percentage
function getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    return parseFloat(memoryUsage.toFixed(2));
}

// Send a single metric to Grafana
async function sendMetricToGrafana(metricName, metricValue, type, unit, attributes = []) {
    try {
        const timestamp = Date.now() * 1000000; // Convert to nanoseconds

        const metric = {
            resourceMetrics: [
                {
                    resource: {
                        attributes: [
                            { key: "service.name", value: { stringValue: config.metrics.source } }
                        ]
                    },
                    scopeMetrics: [
                        {
                            metrics: [
                                {
                                    name: metricName,
                                    unit: unit,
                                    [type]: {
                                        dataPoints: [
                                            {
                                                timeUnixNano: timestamp,
                                                attributes: attributes,
                                                // Use the appropriate value type based on the value
                                                ...(typeof metricValue === 'number' && Number.isInteger(metricValue)
                                                    ? { asInt: metricValue }
                                                    : { asDouble: metricValue })
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                }
            ]
        };

        // Add temporality for sum metrics
        if (type === 'sum') {
            metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
            metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].isMonotonic = true;
        }

        const response = await fetch(config.metrics.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.metrics.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(metric)
        });

        if (!response.ok) {
            console.error(`Failed to send metric ${metricName} to Grafana: ${response.status} ${response.statusText}`);
            const responseText = await response.text();
            console.error('Response details:', responseText);
        } else {
            console.log(`Pushed ${metricName}`);
        }
    } catch (error) {
        console.error(`Error sending metric ${metricName} to Grafana:`, error);
    }
}

// Send all metrics to Grafana
async function sendMetricsToGrafana() {
    try {
        // Process HTTP requests metrics
        for (const [key, count] of Object.entries(metrics.requests)) {
            if (count > 0 && key.includes(':')) {
                const [method, path] = key.split(':');
                const attributes = [
                    { key: "method", value: { stringValue: method } },
                    { key: "path", value: { stringValue: path } },
                    { key: "source", value: { stringValue: config.metrics.source } }
                ];
                await sendMetricToGrafana("http_requests", count, "sum", "1", attributes);
            }
        }

        // Send auth metrics
        if (metrics.auth.successful > 0) {
            await sendMetricToGrafana("auth_attempts", metrics.auth.successful, "sum", "1", [
                { key: "result", value: { stringValue: "success" } },
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);
        }

        if (metrics.auth.failed > 0) {
            await sendMetricToGrafana("auth_failures", metrics.auth.failed, "sum", "1", [
                { key: "result", value: { stringValue: "failure" } },
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);
        }

        // Send active users metric
        await sendMetricToGrafana("active_users", metrics.activeUsers.size, "gauge", "1", [
            { key: "source", value: { stringValue: config.metrics.source } }
        ]);

        // Send system metrics
        const cpuUsage = getCpuUsagePercentage();
        await sendMetricToGrafana("system_cpu_usage", cpuUsage, "gauge", "%", [
            { key: "source", value: { stringValue: config.metrics.source } }
        ]);

        const memoryUsage = getMemoryUsagePercentage();
        await sendMetricToGrafana("system_memory_usage", memoryUsage, "gauge", "%", [
            { key: "source", value: { stringValue: config.metrics.source } }
        ]);

        // Send pizza metrics
        if (metrics.pizzas.sold > 0) {
            await sendMetricToGrafana("pizzas_sold", metrics.pizzas.sold, "sum", "1", [
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);
        }

        if (metrics.pizzas.failures > 0) {
            await sendMetricToGrafana("pizzas_creation_failures", metrics.pizzas.failures, "sum", "1", [
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);
        }

        if (metrics.pizzas.revenue > 0) {
            await sendMetricToGrafana("pizzas_revenue", metrics.pizzas.revenue, "sum", "BTC", [
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);
        }

        // Send latency metrics for endpoints
        for (const [endpoint, durations] of Object.entries(metrics.latency.endpoints)) {
            if (durations.length > 0) {
                const avgLatency = durations.reduce((a, b) => a + b, 0) / durations.length;
                const [method, path] = endpoint.split(':');
                await sendMetricToGrafana("request_latency", avgLatency, "gauge", "ms", [
                    { key: "method", value: { stringValue: method } },
                    { key: "path", value: { stringValue: path.split('?')[0] } },
                    { key: "source", value: { stringValue: config.metrics.source } }
                ]);

                // Clear after reporting
                metrics.latency.endpoints[endpoint] = [];
            }
        }

        // Send pizza creation latency
        if (metrics.latency.pizzaCreation.length > 0) {
            const avgLatency = metrics.latency.pizzaCreation.reduce((a, b) => a + b, 0) /
                metrics.latency.pizzaCreation.length;
            await sendMetricToGrafana("pizza_creation_latency", avgLatency, "gauge", "ms", [
                { key: "source", value: { stringValue: config.metrics.source } }
            ]);

            // Clear after reporting
            metrics.latency.pizzaCreation = [];
        }

        // Reset counters that should be reset after reporting
        Object.keys(metrics.requests).forEach(key => {
            metrics.requests[key] = 0;
        });
        metrics.auth.successful = 0;
        metrics.auth.failed = 0;
        metrics.pizzas.sold = 0;
        metrics.pizzas.failures = 0;
        metrics.pizzas.revenue = 0;

    } catch (error) {
        console.error('Error sending metrics to Grafana:', error);
    }
}

// Send metrics periodically
function startMetricsReporting(interval = 10000) {
    const timer = setInterval(() => {
        try {
            sendMetricsToGrafana();
        } catch (error) {
            console.error('Error sending metrics:', error);
        }
    }, interval);

    // Clean up on process exit
    process.on('SIGTERM', () => {
        clearInterval(timer);
    });

    return timer;
}

// Start metrics reporting when module is loaded
const reportingTimer = startMetricsReporting();

module.exports = {
    track,
    trackAuth,
    trackAuthLogout,
    trackPizzaOrder,
    startMetricsReporting,
    stopMetricsReporting: () => clearInterval(reportingTimer)
};