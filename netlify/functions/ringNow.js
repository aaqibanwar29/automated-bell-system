const mqtt = require('mqtt');

exports.handler = async function(event, context) {
    // Check authentication
    if (!context.clientContext.user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }

    try {
        const data = JSON.parse(event.body);
        const duration = data.duration || 5;

        // Connect to HiveMQ
        const client = mqtt.connect({
            host: process.env.MQTT_HOST,
            port: process.env.MQTT_PORT,
            username: process.env.MQTT_USERNAME,
            password: process.env.MQTT_PASSWORD
        });

        // Wait for connection
        await new Promise((resolve, reject) => {
            client.on('connect', resolve);
            client.on('error', reject);
        });

        // Publish ring command
        await new Promise((resolve, reject) => {
            client.publish('bell/ring/now', duration.toString(), (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        client.end();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Bell rung successfully' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to ring bell' })
        };
    }
};