const mqtt = require('mqtt');

// HiveMQ connection options - optimized for Netlify
const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT || '8883'),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts',
  rejectUnauthorized: false,
  connectTimeout: 8000, // 8 seconds
  keepalive: 30,
  clean: true
};

exports.handler = async function(event, context) {
  console.log('🔔 ringNow function invoked');
  
  // Check authentication
  if (!context.clientContext || !context.clientContext.user) {
    console.log('❌ Unauthorized access attempt');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Unauthorized',
        message: 'Please login to access this feature'
      })
    };
  }

  let mqttClient = null;
  
  try {
    const userEmail = context.clientContext.user.email;
    console.log('User authenticated:', userEmail);
    
    // Parse request body
    let data;
    try {
      data = JSON.parse(event.body);
      console.log('Received ring command:', data);
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Invalid JSON format',
          details: parseError.message 
        })
      };
    }
    
    // Extract and validate duration
    const duration = data.duration || 5;
    if (duration < 1 || duration > 30) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Invalid duration',
          message: 'Duration must be between 1 and 30 seconds'
        })
      };
    }
    
    console.log(`Sending ring command for ${duration} seconds...`);
    
    // Create MQTT client with fast timeout
    mqttClient = mqtt.connect(mqttOptions);
    
    // Use Promise for async/await pattern
    const result = await new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        if (mqttClient) mqttClient.end();
        reject(new Error('MQTT connection timeout (8s)'));
      }, 8000);

      mqttClient.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Connected to MQTT for ring command');
        
        const mqttPayload = JSON.stringify({
          type: 'manual_ring',
          duration: duration,
          timestamp: new Date().toISOString(),
          user: userEmail
        });
        
        mqttClient.publish('bell/ring/now', mqttPayload, { qos: 1 }, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('✅ Ring command published successfully');
            resolve({
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                success: true,
                message: 'Bell ring command sent to ESP32',
                duration: duration,
                timestamp: new Date().toISOString(),
                details: `Bell will ring for ${duration} seconds`
              })
            });
          }
        });
      });

      mqttClient.on('error', (err) => {
        clearTimeout(timeout);
        console.error('MQTT connection error:', err.message);
        reject(err);
      });
    });
    
    // Clean up
    if (mqttClient) {
      mqttClient.end();
    }
    
    return result;
    
  } catch (error) {
    console.error('Function execution error:', error);
    
    // Clean up
    if (mqttClient) {
      mqttClient.end();
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to send ring command',
        message: error.message,
        details: 'Please try again in a moment.'
      })
    };
  }
};