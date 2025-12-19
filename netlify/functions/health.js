const mqtt = require('mqtt');

exports.handler = async function(event, context) {
  console.log('🏥 Health check invoked');
  
  const mqttOptions = {
    host: process.env.MQTT_HOST,
    port: parseInt(process.env.MQTT_PORT || '8883'),
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: 'mqtts',
    rejectUnauthorized: false,
    connectTimeout: 5000
  };
  
  let mqttClient = null;
  
  try {
    mqttClient = mqtt.connect(mqttOptions);
    
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (mqttClient) mqttClient.end();
        reject(new Error('Connection timeout'));
      }, 5000);
      
      mqttClient.on('connect', () => {
        clearTimeout(timeout);
        mqttClient.end();
        resolve({
          status: 'healthy',
          mqtt: 'connected',
          timestamp: new Date().toISOString()
        });
      });
      
      mqttClient.on('error', (err) => {
        clearTimeout(timeout);
        mqttClient.end();
        reject(err);
      });
    });
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'unhealthy',
        mqtt: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};