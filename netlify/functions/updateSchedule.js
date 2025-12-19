const mqtt = require('mqtt');

// HiveMQ connection options - optimized for Netlify
const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT || '8883'),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts',
  rejectUnauthorized: false,
  connectTimeout: 10000, // 10 seconds
  keepalive: 60,
  clean: true,
  resubscribe: false
};

// Global MQTT client connection (reused across function invocations)
let mqttClient = null;
let isConnecting = false;
const connectionPromise = new Map();

async function ensureMQTTConnection() {
  // If already connecting, wait for that connection
  if (isConnecting) {
    return new Promise((resolve) => {
      const checkConnection = setInterval(() => {
        if (mqttClient && mqttClient.connected) {
          clearInterval(checkConnection);
          resolve(true);
        }
      }, 100);
    });
  }

  // If already connected, return
  if (mqttClient && mqttClient.connected) {
    return true;
  }

  isConnecting = true;
  
  return new Promise((resolve, reject) => {
    console.log('Creating new MQTT connection...');
    
    // Create new client
    mqttClient = mqtt.connect(mqttOptions);
    
    // Set connection timeout
    const timeout = setTimeout(() => {
      if (mqttClient) mqttClient.end();
      isConnecting = false;
      reject(new Error('MQTT connection timeout (10s)'));
    }, 10000);

    mqttClient.on('connect', () => {
      clearTimeout(timeout);
      console.log('✅ MQTT Connected successfully to:', mqttOptions.host);
      isConnecting = false;
      resolve(true);
    });

    mqttClient.on('error', (err) => {
      clearTimeout(timeout);
      console.error('❌ MQTT Connection error:', err.message);
      isConnecting = false;
      reject(err);
    });

    mqttClient.on('close', () => {
      console.log('MQTT connection closed');
      isConnecting = false;
    });
  });
}

async function publishWithRetry(topic, message, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await ensureMQTTConnection();
      
      return new Promise((resolve, reject) => {
        console.log(`Publishing to ${topic} (attempt ${attempt}/${retries})`);
        
        mqttClient.publish(topic, JSON.stringify(message), { qos: 1 }, (err) => {
          if (err) {
            console.error(`Publish attempt ${attempt} failed:`, err.message);
            reject(err);
          } else {
            console.log(`✅ Published to ${topic} successfully`);
            resolve();
          }
        });
        
        // Timeout for publish operation
        setTimeout(() => {
          reject(new Error(`Publish timeout for ${topic}`));
        }, 5000);
      });
      
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
    }
  }
}

exports.handler = async function(event, context) {
  console.log('📋 updateSchedule function invoked');
  
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

  try {
    const userEmail = context.clientContext.user.email;
    console.log('User authenticated:', userEmail);
    
    // Parse request body
    let data;
    try {
      data = JSON.parse(event.body);
      console.log('Received schedule data for', data.periods?.length || 0, 'periods');
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
    
    // Validate data
    if (!data.periods || !Array.isArray(data.periods)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Invalid data format',
          message: 'Schedule data must contain a periods array'
        })
      };
    }
    
    // Create MQTT payload
    const mqttPayload = {
      type: 'schedule_update',
      timestamp: new Date().toISOString(),
      user: userEmail,
      schedule: data,
      periodCount: data.periods.length
    };
    
    console.log('Publishing schedule update to MQTT...');
    
    // Publish to MQTT with retry logic
    await publishWithRetry('bell/schedule/update', mqttPayload, 2);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: true,
        message: 'Schedule updated and sent to ESP32',
        timestamp: new Date().toISOString(),
        periodCount: data.periods.length,
        details: `Sent ${data.periods.length} periods to bell system`
      })
    };
    
  } catch (error) {
    console.error('Function execution error:', error);
    
    // Clean up MQTT connection on error
    if (mqttClient) {
      mqttClient.end();
      mqttClient = null;
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        message: error.message,
        details: 'Failed to update schedule. Please try again.'
      })
    };
  }
};