const mqtt = require('mqtt');

exports.handler = async function(event, context) {
  console.log('⏰ Time sync function called');
  
  // Check authentication
  if (!context.clientContext || !context.clientContext.user) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    // Parse request (could be empty for auto-sync)
    let data = {};
    if (event.body) {
      data = JSON.parse(event.body);
    }
    
    // Get current time
    const now = new Date();
    const timeData = {
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      timestamp: now.toISOString(),
      source: 'web_app',
      user: context.clientContext.user.email
    };
    
    // If manual time provided, use it
    if (data.hour !== undefined && data.minute !== undefined) {
      timeData.hour = data.hour;
      timeData.minute = data.minute;
      timeData.second = data.second || 0;
      timeData.manual = true;
    }
    
    console.log('Sending time to ESP32:', timeData);
    
    // Connect to MQTT
    const client = mqtt.connect({
      host: process.env.MQTT_HOST,
      port: parseInt(process.env.MQTT_PORT || '8883'),
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      protocol: 'mqtts'
    });
    
    const result = await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('MQTT connected for time sync');
        
        client.publish('bell/time/sync', JSON.stringify(timeData), { qos: 1 }, (err) => {
          client.end();
          
          if (err) {
            reject(err);
          } else {
            resolve({
              success: true,
              time: `${timeData.hour.toString().padStart(2, '0')}:${timeData.minute.toString().padStart(2, '0')}:${timeData.second.toString().padStart(2, '0')}`,
              timestamp: timeData.timestamp
            });
          }
        });
      });
      
      client.on('error', reject);
      
      // Timeout
      setTimeout(() => {
        client.end();
        reject(new Error('MQTT connection timeout'));
      }, 5000);
    });
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
    
  } catch (error) {
    console.error('Time sync error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Time sync failed',
        message: error.message 
      })
    };
  }
};